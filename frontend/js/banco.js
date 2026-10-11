// Página do banco (adjunto): toca no mapa, escolhe o jogador e carrega no resultado.
import { h, substituir, avisar } from './dom.js';
import {
  obter, enviar, formatarTempo, RESULTADOS, ROTULO_RESULTADO, SITUACOES, ROTULO_ZONA_BALIZA, zonaBaliza,
} from './api.js';
import { criarCampo } from './campo.js';
import { criarBaliza } from './baliza.js';
import { ligar, TEXTO_ESTADO } from './tempo-real.js';

const jogoId = Number(new URLSearchParams(location.search).get('jogo'));
if (!jogoId) location.replace('./');

const PONTO_SETE_METROS = { x: 50, y: 35 }; // marca de 7 m

const estado = {
  jogo: null,
  tipos: [],
  estatisticas: null,
  lado: 'casa',          // equipa que ataca: 'casa' | 'fora'
  jogadorId: null,
  ponto: null,           // { x, y } do clique no mapa
  situacao: 'POSICIONAL',
  grPorEquipa: {},       // equipaId -> id do guarda-redes adversário escolhido
  aEnviar: false,
  aEscolherBaliza: false, // janela da baliza aberta
  ligado: false,
};

// ---------------------------------------------------------------------
// Relógio de jogo (guardado no tablet, sobrevive a recarregar a página)
// ---------------------------------------------------------------------
const CHAVE_RELOGIO = `relogio-jogo-${jogoId}`;
const relogio = lerRelogio();

function lerRelogio() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CHAVE_RELOGIO));
    if (guardado) return guardado;
  } catch { /* sem armazenamento */ }
  return { acumuladoMs: 0, iniciadoEm: null, parte: 1 };
}
function guardarRelogio() {
  try { localStorage.setItem(CHAVE_RELOGIO, JSON.stringify(relogio)); } catch { /* ignora */ }
}
function segundosDeJogo() {
  const extra = relogio.iniciadoEm ? Date.now() - relogio.iniciadoEm : 0;
  return Math.floor((relogio.acumuladoMs + extra) / 1000);
}
function pausarRelogio() {
  if (relogio.iniciadoEm) {
    relogio.acumuladoMs += Date.now() - relogio.iniciadoEm;
    relogio.iniciadoEm = null;
  }
}
function alternarRelogio() {
  if (relogio.iniciadoEm) pausarRelogio();
  else relogio.iniciadoEm = Date.now();
  guardarRelogio();
  desenharRelogio();
}
function alternarParte() {
  pausarRelogio();
  if (relogio.parte === 1) {
    relogio.parte = 2;
    relogio.acumuladoMs = Math.max(segundosDeJogo(), 30 * 60) * 1000; // a 2.ª parte começa aos 30:00
  } else {
    relogio.parte = 1;
  }
  guardarRelogio();
  desenharRelogio();
}
function ajustarRelogio() {
  const resposta = prompt('Minuto de jogo (0 a 60):', String(Math.floor(segundosDeJogo() / 60)));
  if (resposta === null) return;
  const minutos = Number(resposta.replace(',', '.'));
  if (!Number.isFinite(minutos) || minutos < 0 || minutos > 120) { avisar('Minuto inválido.', { erro: true }); return; }
  const estavaAMarchar = Boolean(relogio.iniciadoEm);
  relogio.acumuladoMs = Math.round(minutos * 60000);
  relogio.iniciadoEm = estavaAMarchar ? Date.now() : null;
  guardarRelogio();
  desenharRelogio();
}
function desenharRelogio() {
  document.getElementById('tempo').textContent = formatarTempo(segundosDeJogo());
  document.getElementById('btn-relogio').textContent = relogio.iniciadoEm ? '⏸' : '▶';
  document.getElementById('btn-parte').textContent = `${relogio.parte}.ª parte`;
}

// ---------------------------------------------------------------------
// Dados derivados
// ---------------------------------------------------------------------
const equipaAtacante = () => (estado.lado === 'casa' ? estado.jogo.casaId : estado.jogo.foraId);
const equipaAdversaria = () => (estado.lado === 'casa' ? estado.jogo.foraId : estado.jogo.casaId);
const jogadoresDe = (equipaId) => estado.jogo.jogadores.filter((j) => j.equipaId === equipaId);
const temConvocatoria = (equipaId) => jogadoresDe(equipaId).some((j) => j.convocado);
/** Jogadores disponíveis no banco: os convocados; se a equipa ainda não tem convocatória, todos. */
const plantelDe = (equipaId) => (temConvocatoria(equipaId) ? jogadoresDe(equipaId).filter((j) => j.convocado) : jogadoresDe(equipaId));
const nomeCurto = (nome) => nome.split(' ')[0];

function guardaRedesAdversario() {
  const lista = plantelDe(equipaAdversaria()).filter((j) => j.posicao === 'GR');
  const escolhido = estado.grPorEquipa[equipaAtacante()];
  return lista.find((j) => j.id === escolhido) ?? lista[0] ?? null;
}

// ---------------------------------------------------------------------
// Desenho da página
// ---------------------------------------------------------------------
const campo = criarCampo(document.getElementById('campo'), {
  aoClicar(ponto) {
    estado.ponto = ponto;
    if (estado.situacao === 'SETE_METROS') estado.situacao = 'POSICIONAL';
    desenharTudo();
  },
});

function desenharTudo() {
  if (!estado.jogo) return;
  desenharPlacar();
  desenharSeletorEquipa();
  desenharJogadores();
  desenharSituacoes();
  desenharGuardaRedes();
  desenharResultados();
  desenharOutros();
  desenharUltimos();
  campo.pendente(estado.ponto);
  desenharDica();
}

function desenharPlacar() {
  const { jogo, estatisticas } = estado;
  document.getElementById('nome-casa').textContent = jogo.casaNome;
  document.getElementById('nome-fora').textContent = jogo.foraNome;
  const golos = (equipaId) => estatisticas?.equipas.find((e) => e.equipaId === equipaId)?.golos ?? 0;
  document.getElementById('golos-casa').textContent = golos(jogo.casaId);
  document.getElementById('golos-fora').textContent = golos(jogo.foraId);
}

function desenharSeletorEquipa() {
  const botao = (lado, nome) => h('button', {
    type: 'button', 'data-lado': lado, class: estado.lado === lado ? 'ativo' : '',
    onclick: () => {
      if (estado.lado === lado) return;
      estado.lado = lado;
      estado.jogadorId = null;
      desenharTudo();
    },
  }, `Ataca: ${nome}`);
  substituir(document.getElementById('seletor-equipa'),
    botao('casa', estado.jogo.casaNome), botao('fora', estado.jogo.foraNome));
}

function desenharJogadores() {
  const jogadores = plantelDe(equipaAtacante())
    .filter((j) => j.posicao !== 'GR')
    .sort((a, b) => a.numero - b.numero);
  const grelha = document.getElementById('jogadores');
  grelha.dataset.lado = estado.lado;
  substituir(grelha, jogadores.length
    ? jogadores.map((j) => h('button', {
      type: 'button', class: `botao-jogador${estado.jogadorId === j.id ? ' ativo' : ''}`,
      onclick: () => {
        estado.jogadorId = estado.jogadorId === j.id ? null : j.id;
        desenharTudo();
      },
    }, h('b', {}, j.numero), h('small', {}, nomeCurto(j.nome)), h('em', {}, j.posicao)))
    : h('p', { class: 'vazio' }, 'Sem jogadores de campo convocados.'));

  const nota = document.getElementById('nota-convocatoria');
  nota.hidden = temConvocatoria(equipaAtacante());
  if (!nota.hidden && !nota.firstChild) {
    nota.append('Sem convocatória: a mostrar todos os jogadores. ',
      h('a', { href: `convocatoria.html?jogo=${jogoId}` }, 'Escolher convocados'));
  }
}

function desenharSituacoes() {
  substituir(document.getElementById('situacoes'), SITUACOES.map((s) => h('button', {
    type: 'button', class: estado.situacao === s.codigo ? 'ativo' : '',
    onclick: () => {
      estado.situacao = s.codigo;
      if (s.codigo === 'SETE_METROS') estado.ponto = { ...PONTO_SETE_METROS };
      desenharTudo();
    },
  }, s.rotulo)));
}

function desenharGuardaRedes() {
  const lista = plantelDe(equipaAdversaria()).filter((j) => j.posicao === 'GR');
  const atual = guardaRedesAdversario();
  const seletor = document.getElementById('guarda-redes');
  substituir(seletor, lista.length
    ? lista.map((j) => h('option', { value: j.id, selected: j.id === atual?.id }, `#${j.numero} ${j.nome}`))
    : h('option', { value: '' }, 'sem guarda-redes'));
  seletor.onchange = () => { estado.grPorEquipa[equipaAtacante()] = Number(seletor.value); };
}

function desenharResultados() {
  substituir(document.getElementById('resultados'), RESULTADOS.map((r) => h('button', {
    type: 'button', class: 'botao-resultado', 'data-resultado': r, disabled: estado.aEnviar,
    onclick: () => registarRemate(r),
  }, ROTULO_RESULTADO[r])));
}

function desenharOutros() {
  const tipos = estado.tipos.filter((t) => !t.eRemate);
  substituir(document.getElementById('outros'), tipos.map((t) => h('button', {
    type: 'button', onclick: () => registarOutro(t),
  }, t.nome)));
}

function descreverEvento(e) {
  const quem = e.jogadorNumero != null ? `#${e.jogadorNumero} ${e.jogadorNome}` : '';
  const lado = e.equipaId === estado.jogo.casaId ? 'casa' : 'fora';
  return h('li', {},
    h('span', { class: 'hora' }, `${e.parte}.ª ${formatarTempo(e.segundoJogo)}`),
    h('span', { class: 'texto' },
      h('span', { class: `ponto-equipa ${lado}` }),
      e.resultado
        ? [h('span', { class: 'etiqueta', 'data-resultado': e.resultado }, ROTULO_RESULTADO[e.resultado]), ' ', quem,
          e.balizaZona ? h('span', { class: 'zona-baliza' }, ` · ${ROTULO_ZONA_BALIZA[e.balizaZona]}`) : null]
        : [h('span', { class: 'etiqueta neutra' }, e.tipoNome), ' ', quem]),
    h('button', { type: 'button', class: 'apagar', title: 'Apagar este evento', onclick: () => apagarEvento(e) }, '✕'));
}

function desenharUltimos() {
  const eventos = (estado.estatisticas?.ultimosEventos ?? []).slice(0, 8);
  substituir(document.getElementById('ultimos'),
    eventos.length ? eventos.map(descreverEvento) : h('li', { class: 'vazio' }, 'Ainda sem eventos.'));
  document.getElementById('btn-desfazer').disabled = eventos.length === 0;
}

function desenharDica() {
  const falta = [];
  if (!estado.ponto) falta.push('toca no mapa');
  if (!estado.jogadorId) falta.push('escolhe o jogador');
  const dica = document.getElementById('dica');
  dica.className = `dica${falta.length ? '' : ' pronto'}`;
  dica.textContent = falta.length
    ? `Falta: ${falta.join(' e ')}.`
    : 'Pronto: carrega no resultado para registar.';
}

// ---------------------------------------------------------------------
// Janela da baliza (onde o guarda-redes defendeu)
// ---------------------------------------------------------------------
const janelaBaliza = document.getElementById('janela-baliza');
let resolverJanela = null;
let focoAntes = null;

criarBaliza(document.getElementById('baliza'), {
  aoClicar: ({ x, y }) => fecharJanelaBaliza({ x, y }),
});

/** Abre a janela. Devolve {x, y} se tocou na baliza, null se escolheu "sem local" e undefined se cancelou. */
function pedirLocalDaDefesa(guardaRedes) {
  return new Promise((resolve) => {
    resolverJanela = resolve;
    focoAntes = document.activeElement;
    document.getElementById('sub-baliza').textContent = guardaRedes
      ? `Guarda-redes adversário: #${guardaRedes.numero} ${guardaRedes.nome}`
      : 'Sem guarda-redes escolhido';
    janelaBaliza.hidden = false;
    document.getElementById('baliza-cancelar').focus({ preventScroll: true });
  });
}

function fecharJanelaBaliza(resultado) {
  if (!resolverJanela) return;
  const resolver = resolverJanela;
  resolverJanela = null;
  janelaBaliza.hidden = true;
  focoAntes?.focus?.({ preventScroll: true });
  resolver(resultado);
}

document.getElementById('baliza-cancelar').addEventListener('click', () => fecharJanelaBaliza(undefined));
document.getElementById('baliza-sem-local').addEventListener('click', () => fecharJanelaBaliza(null));
janelaBaliza.addEventListener('click', (evento) => { if (evento.target === janelaBaliza) fecharJanelaBaliza(undefined); });
document.addEventListener('keydown', (evento) => { if (evento.key === 'Escape') fecharJanelaBaliza(undefined); });

// ---------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------
function corpoBase(tipoEvento) {
  return {
    tipoEvento,
    equipaId: equipaAtacante(),
    parte: relogio.parte,
    segundoJogo: segundosDeJogo(),
  };
}

async function registar(corpo, mensagem) {
  estado.aEnviar = true;
  desenharResultados();
  try {
    await enviar('POST', `/api/jogos/${jogoId}/eventos`, corpo);
    avisar(mensagem);
    estado.jogadorId = null;
    estado.ponto = null;
    estado.situacao = 'POSICIONAL';
    if (!estado.ligado) await atualizarPorHttp(); // sem WebSocket, vai buscar o estado
  } catch (erro) {
    avisar(`Não ficou registado: ${erro.message}`, { erro: true });
  } finally {
    estado.aEnviar = false;
    desenharTudo();
  }
}

async function registarRemate(resultado) {
  if (estado.aEnviar || estado.aEscolherBaliza) return;
  if (!estado.ponto || !estado.jogadorId) {
    avisar(!estado.ponto ? 'Toca primeiro no mapa.' : 'Escolhe o jogador.', { erro: true });
    return;
  }
  const jogador = estado.jogo.jogadores.find((j) => j.id === estado.jogadorId);
  const guardaRedes = guardaRedesAdversario();
  const ponto = estado.ponto;
  const corpo = {
    ...corpoBase('REMATE'),
    jogadorId: jogador.id,
    guardaRedesId: guardaRedes?.id ?? null,
    resultado,
    situacao: estado.situacao,
    x: ponto.x,
    y: ponto.y,
  };
  let descricao = `${ROTULO_RESULTADO[resultado]} · #${jogador.numero} ${jogador.nome}`;

  // Numa defesa, abre a baliza para marcar onde o guarda-redes defendeu a bola
  if (resultado === 'DEFESA') {
    estado.aEscolherBaliza = true;
    const escolha = await pedirLocalDaDefesa(guardaRedes);
    estado.aEscolherBaliza = false;
    if (escolha === undefined) return; // cancelou: nada fica registado
    if (escolha) {
      corpo.balizaX = escolha.x;
      corpo.balizaY = escolha.y;
      descricao += ` · ${ROTULO_ZONA_BALIZA[zonaBaliza(escolha.x, escolha.y)]}`;
    }
  }
  registar(corpo, descricao);
}

function registarOutro(tipo) {
  if (estado.aEnviar) return;
  const jogador = estado.jogo.jogadores.find((j) => j.id === estado.jogadorId);
  registar({
    ...corpoBase(tipo.codigo),
    jogadorId: jogador?.id ?? null,
  }, `${tipo.nome}${jogador ? ` · #${jogador.numero} ${jogador.nome}` : ''}`);
}

async function apagarEvento(evento) {
  const descricao = evento.resultado
    ? `${ROTULO_RESULTADO[evento.resultado]} de #${evento.jogadorNumero}`
    : evento.tipoNome;
  if (!confirm(`Apagar "${descricao}" (${formatarTempo(evento.segundoJogo)})?`)) return;
  try {
    await enviar('DELETE', `/api/jogos/${jogoId}/eventos/${evento.id}`);
    avisar('Evento apagado.');
    if (!estado.ligado) await atualizarPorHttp();
  } catch (erro) {
    avisar(`Não foi possível apagar: ${erro.message}`, { erro: true });
  }
}

function receberEstatisticas(estatisticas) {
  estado.estatisticas = estatisticas;
  desenharTudo();
}

async function atualizarPorHttp() {
  receberEstatisticas(await obter(`/api/jogos/${jogoId}/estatisticas`));
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
document.getElementById('btn-relogio').addEventListener('click', alternarRelogio);
document.getElementById('btn-parte').addEventListener('click', alternarParte);
document.getElementById('btn-ajustar').addEventListener('click', ajustarRelogio);
document.getElementById('btn-desfazer').addEventListener('click', () => {
  const ultimo = estado.estatisticas?.ultimosEventos?.[0];
  if (ultimo) apagarEvento(ultimo);
});

function mostrarEstadoLigacao(codigo) {
  estado.ligado = codigo === 'ligado';
  const el = document.getElementById('ligacao');
  el.className = `ligacao ${codigo === 'ligado' ? 'ok' : codigo}`;
  el.textContent = TEXTO_ESTADO[codigo];
}

setInterval(desenharRelogio, 500);
desenharRelogio();

try {
  [estado.jogo, estado.tipos] = await Promise.all([
    obter(`/api/jogos/${jogoId}`),
    obter('/api/tipos-evento'),
  ]);
  document.title = `${estado.jogo.casaNome} vs ${estado.jogo.foraNome} · Banco`;
  desenharTudo();
  ligar(jogoId, receberEstatisticas, mostrarEstadoLigacao);
} catch (erro) {
  substituir(document.querySelector('main'),
    h('p', { class: 'vazio' }, `Não foi possível carregar o jogo: ${erro.message}`),
    h('a', { href: './' }, '← Voltar à lista de jogos'));
}
