// Fila de eventos do banco: cada evento fica guardado no tablet e é enviado ao servidor por ordem.
// Com rede segue logo; sem rede espera e envia-se sozinho quando ela volta. Não depende do browser (o armazenamento
// entra por parâmetro), por isso testa-se com node (tests/unidade/fila.test.mjs).
//
// Cada evento leva um identificador gerado aqui (clienteId): se o envio se repetir, porque a resposta se perdeu,
// o servidor reconhece-o e não regista o evento duas vezes.

const CHAVE = 'scouting.fila.v1';

/** UUID v4. O crypto.randomUUID só existe em contextos seguros (https ou localhost): num tablet em http usa-se o getRandomValues. */
export function novoId() {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < b.length; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}

/**
 * A fila guarda-se no armazenamento do browser (localStorage), por isso sobrevive a recarregar a página e a fechar
 * o browser. Sem armazenamento (navegação privada, cheio) fica só em memória: continua a funcionar até se fechar a página.
 */
export function criarFila({ armazenamento = globalThis.localStorage, chave = CHAVE, agora = () => new Date(), gerarId = novoId } = {}) {
  let memoria = [];
  let emMemoria = false;

  function ler() {
    if (emMemoria) return memoria;
    try {
      const texto = armazenamento.getItem(chave);
      const lista = texto ? JSON.parse(texto) : [];
      return Array.isArray(lista) ? lista : [];
    } catch {
      emMemoria = true;
      return memoria;
    }
  }
  function guardar(lista) {
    memoria = lista;
    if (emMemoria) return;
    try {
      armazenamento.setItem(chave, JSON.stringify(lista));
    } catch {
      emMemoria = true;
    }
  }

  return {
    /** Põe um evento no fim da fila. Devolve o item, que leva o clienteId e a hora a que o evento aconteceu. */
    adicionar(jogoId, corpo) {
      const clienteId = gerarId();
      const ocorridoEm = agora().toISOString();
      const item = { clienteId, jogoId, corpo: { ...corpo, clienteId, ocorridoEm }, criadoEm: ocorridoEm, tentativas: 0 };
      guardar([...ler(), item]);
      return item;
    },
    todos: () => ler(),
    doJogo: (jogoId) => ler().filter((i) => i.jogoId === jogoId),
    contar: () => ler().length,
    remover(clienteId) {
      const lista = ler();
      const restantes = lista.filter((i) => i.clienteId !== clienteId);
      if (restantes.length === lista.length) return false;
      guardar(restantes);
      return true;
    },
    /** Conta mais uma tentativa falhada do item (erros do servidor) e devolve quantas leva. */
    registarTentativa(clienteId) {
      let n = 0;
      guardar(ler().map((i) => {
        if (i.clienteId !== clienteId) return i;
        n = (i.tentativas ?? 0) + 1;
        return { ...i, tentativas: n };
      }));
      return n;
    },
    get emMemoria() { return emMemoria; },
  };
}

/**
 * O que fazer com um envio falhado:
 *  'rede'       o pedido nem chegou ao servidor (sem rede, servidor em baixo): espera e volta a tentar;
 *  'sessao'     a sessão terminou (401): guarda tudo, a pessoa tem de entrar outra vez;
 *  'transitorio' o servidor falhou (5xx, 429, 408): volta a tentar, mas só algumas vezes;
 *  'rejeitado'  o servidor percebeu e recusou (400, 404...): repetir não adianta, o evento sai da fila.
 */
export function classificar(erro) {
  const estado = erro?.status;
  if (estado == null) return 'rede';
  if (estado === 401) return 'sessao';
  if (estado === 408 || estado === 429 || estado >= 500) return 'transitorio';
  return 'rejeitado';
}

/**
 * Envia a fila por ordem, um evento de cada vez (a ordem importa: um 2 minutos, depois o golo em superioridade).
 * `enviar(item)` tem de resolver se o servidor aceitou o evento (também se já o tinha) e rejeitar com um erro
 * com `status` se o servidor respondeu mal. Pára no primeiro erro que não se resolve já.
 * Devolve { estado: 'vazia' | 'sem-rede' | 'sessao' | 'erro-servidor', enviados, rejeitados }.
 */
export async function drenar(fila, enviar, { aoRejeitar = () => {}, aoEnviar = () => {}, maximoTentativas = 8 } = {}) {
  let enviados = 0;
  const rejeitados = [];
  const rejeitar = (item, erro) => {
    fila.remover(item.clienteId);
    rejeitados.push({ item, erro });
    aoRejeitar(item, erro);
  };

  for (;;) {
    const item = fila.todos()[0];
    if (!item) return { estado: 'vazia', enviados, rejeitados };
    try {
      await enviar(item);
      fila.remover(item.clienteId);
      enviados += 1;
      aoEnviar(item);
    } catch (erro) {
      const tipo = classificar(erro);
      if (tipo === 'rede') return { estado: 'sem-rede', enviados, rejeitados };
      if (tipo === 'sessao') return { estado: 'sessao', enviados, rejeitados };
      if (tipo === 'rejeitado') { rejeitar(item, erro); continue; }
      if (fila.registarTentativa(item.clienteId) >= maximoTentativas) { rejeitar(item, erro); continue; }
      return { estado: 'erro-servidor', enviados, rejeitados };
    }
  }
}

/**
 * Quem envia a fila: nunca corre duas vezes ao mesmo tempo e, se ficou algo por enviar, volta a tentar sozinho
 * (2 s, 5 s, 10 s, 20 s e depois de 20 em 20 s). `tentar()` pode ser chamado a qualquer momento (voltou a rede,
 * houve um evento novo...) e antecipa a tentativa seguinte.
 */
export function criarEnvio({
  fila, enviar, aoRejeitar, aoEnviar, aoTerminar,
  esperas = [2000, 5000, 10000, 20000], agendar = setTimeout, cancelar = clearTimeout,
}) {
  let aCorrer = false;
  let falhas = 0;
  let temporizador = null;

  async function tentar() {
    if (aCorrer) return null;
    aCorrer = true;
    cancelar(temporizador);
    temporizador = null;
    let resultado = null;
    try {
      resultado = await drenar(fila, enviar, { aoRejeitar, aoEnviar });
      if (resultado.estado === 'vazia') {
        falhas = 0;
      } else if (resultado.estado !== 'sessao') {
        temporizador = agendar(tentar, esperas[Math.min(falhas, esperas.length - 1)]);
        falhas += 1;
      }
    } finally {
      aCorrer = false;
    }
    aoTerminar?.(resultado);
    return resultado;
  }

  return { tentar, get aCorrer() { return aCorrer; } };
}
