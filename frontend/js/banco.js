// Página do banco (adjunto): toca no mapa, escolhe o jogador e carrega no resultado.
import { h, substituir, avisar } from './dom.js';
import {
  obter, enviar, formatarTempo, RESULTADOS, ROTULO_RESULTADO, SITUACOES, ROTULO_ZONA_BALIZA, zonaBaliza,
  SISTEMAS_DEFENSIVOS,
} from './api.js';
import { criarCampo } from './campo.js';
import { criarBaliza } from './baliza.js';
import { ligar, TEXTO_ESTADO } from './tempo-real.js';
import { exigirConta } from './conta.js';
import { escudo } from './escudo.js';
import { desenharFaixa } from './faixa-numerica.js';
import { formatarRestante } from './numerica.js';
import { novoTimeout, estadoTimeout } from './timeout.js';
import { criarFila, criarEnvio } from './fila.js';
import { aplicarPendentes, resumoParaGuardar } from './otimista.js';
import { registarOffline, chaveCacheBanco } from './offline.js';

const jogoId = Number(new URLSearchParams(location.search).get('jogo'));
if (!jogoId) location.replace('./');

registarOffline();
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Sem rede (ou com a rede a arrastar-se) a conta não chega: não prende a página, o banco abre na mesma. */
await Promise.race([exigirConta(), esperar(6000)]);

const PONTO_SETE_METROS = { x: 50, y: 35 }; // marca de 7 m

// Eventos por enviar: cada toque no banco entra aqui (fica guardado no tablet) e segue para o servidor por ordem,
// logo que há rede. O banco mostra-os desde o primeiro instante (ver otimista.js).
const fila = criarFila();
const CONFIRMADO_ATE_CHEGAR_MS = 8000;

const CHAVE_SISTEMAS = `sistema-defensivo-${jogoId}`;   // a defesa do adversário escolhida no banco (ver mais abaixo)

const estado = {
  jogo: null,
  tipos: [],
  estatisticasServidor: null,  // o que o servidor mandou
  estatisticas: null,          // o que o banco mostra: o do servidor + os eventos ainda por enviar
  confirmados: [],             // enviados há pouco, ainda não nas estatísticas do servidor (para não "desaparecerem" do marcador)
  codigoLigacao: 'espera',
  lado: 'casa',          // equipa que ataca: 'casa' | 'fora'
  jogadorId: null,
  ponto: null,           // { x, y } do clique no mapa
  situacao: 'POSICIONAL',
  grPorEquipa: {},       // equipaId -> id do guarda-redes adversário escolhido
  sistemaPorEquipa: lerSistemas(),   // equipaId de quem defende -> defesa que está a jogar (6_0, 5_1...); fica até a mudarem
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
    if (guardado) return { timeout: null, ...guardado };
  } catch { /* sem armazenamento */ }
  return { acumuladoMs: 0, iniciadoEm: null, parte: 1, timeout: null };
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
  else relogio.iniciadoEm = Date.now();   // ▶ durante um time-out retoma o jogo (a faixa do time-out sai em desenharRelogio)
  relogio.timeout = null;
  guardarRelogio();
  desenharRelogio();
  sincronizarRelogio();
}
function alternarParte() {
  pausarRelogio();
  relogio.timeout = null;
  if (relogio.parte === 1) {
    relogio.parte = 2;
    relogio.acumuladoMs = Math.max(segundosDeJogo(), 30 * 60) * 1000; // a 2.ª parte começa aos 30:00
  } else {
    relogio.parte = 1;
  }
  guardarRelogio();
  desenharRelogio();
  sincronizarRelogio();
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
  sincronizarRelogio();
}
function desenharRelogio() {
  document.getElementById('tempo').textContent = formatarTempo(segundosDeJogo());
  document.getElementById('btn-relogio').textContent = relogio.iniciadoEm ? '⏸' : '▶';
  document.getElementById('btn-parte').textContent = `${relogio.parte}.ª parte`;
  desenharTimeout();
  desenharNumerica();
}

// ---------------------------------------------------------------------
// Time-out: o relógio de jogo pára e conta-se o minuto do time-out até zero
// ---------------------------------------------------------------------
let timeoutAcabadoAvisado = false;

/** Pára o relógio de jogo e começa o minuto do time-out da equipa (as sanções em curso também ficam paradas). */
function iniciarTimeout(equipaId) {
  pausarRelogio();
  relogio.timeout = novoTimeout(equipaId);
  timeoutAcabadoAvisado = false;
  guardarRelogio();
  desenharRelogio();
  sincronizarRelogio();
}

/** Acaba o time-out. Com `retomar`, o relógio de jogo volta a andar. */
function terminarTimeout({ retomar = false } = {}) {
  if (!relogio.timeout) return;
  relogio.timeout = null;
  if (retomar && !relogio.iniciadoEm) relogio.iniciadoEm = Date.now();
  guardarRelogio();
  desenharRelogio();
  sincronizarRelogio();
}

function desenharTimeout() {
  const faixa = document.getElementById('faixa-timeout');
  const situacao = estadoTimeout(relogio.timeout);
  if (relogio.timeout && !situacao) {   // esquecido há muito tempo: sai sem barulho
    relogio.timeout = null;
    guardarRelogio();
  }
  faixa.hidden = !situacao;
  document.getElementById('tempo').classList.toggle('em-timeout', Boolean(situacao));
  if (!situacao) return;
  faixa.classList.toggle('acabou', situacao.acabou);
  document.getElementById('timeout-equipa').textContent = equipaDoTimeout();
  document.getElementById('timeout-tempo').textContent = formatarRestante(situacao.restante);
  document.getElementById('timeout-nota').textContent = situacao.acabou ? 'fim do time-out · retoma o jogo' : 'relógio de jogo parado';
  if (situacao.acabou && !timeoutAcabadoAvisado) {
    timeoutAcabadoAvisado = true;
    navigator.vibrate?.([300, 150, 300]);
  }
}

function equipaDoTimeout() {
  const { casaId, casaNome, foraNome } = estado.jogo ?? {};
  if (!estado.jogo) return '';
  return relogio.timeout.equipaId === casaId ? casaNome : foraNome;
}

/**
 * Diz ao servidor em que segundo está o relógio e se anda (arrancar, parar, ajustar, mudar de parte e, enquanto
 * corre, de 30 em 30 segundos). É assim que o dashboard e quem vê o link sabem quanto falta a cada 2 minutos.
 * Se falhar (sem rede) não faz mal: o aviso seguinte volta a tentar e os eventos levam sempre o seu próprio segundo.
 */
function sincronizarRelogio() {
  enviar('PUT', `/api/jogos/${jogoId}/relogio`, {
    segundo: Math.min(segundosDeJogo(), 7200),
    aCorrer: Boolean(relogio.iniciadoEm),
  }).catch(() => { /* tenta no próximo aviso */ });
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

// Sanções: o 3.º "2 minutos" ou um vermelho direto desqualifica o jogador (a regra está na base de dados, vista v_sancoes).
// Quem está expulso deixa de poder ser escolhido, mas os eventos que já tem continuam nas estatísticas.
const sancaoDe = (jogadorId) => estado.estatisticas?.sancoes?.find((s) => s.jogadorId === jogadorId) ?? null;
const motivoExpulsao = (sancao) => (sancao.vermelhos > 0 ? 'vermelho direto' : `${sancao.doisMinutos} × 2 minutos`);

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
  desenharSistemas();
  desenharGuardaRedes();
  desenharResultados();
  desenharOutros();
  desenharNumerica();
  desenharUltimos();
  desenharPendentes();
  campo.pendente(estado.ponto);
  desenharDica();
}

function desenharPlacar() {
  const { jogo, estatisticas } = estado;
  document.getElementById('nome-casa').textContent = jogo.casaNome;
  document.getElementById('nome-fora').textContent = jogo.foraNome;
  substituir(document.getElementById('escudo-casa'), escudo(jogo.casaId, jogo.casaEscudo, 'placar'));
  substituir(document.getElementById('escudo-fora'), escudo(jogo.foraId, jogo.foraEscudo, 'placar'));
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

function botaoJogador(j) {
  const sancao = sancaoDe(j.id);
  const expulso = Boolean(sancao?.expulso);
  const marca = !expulso && sancao?.doisMinutos
    ? h('span', { class: 'sancao', title: `${sancao.doisMinutos} × 2 minutos` }, `2′×${sancao.doisMinutos}`)
    : null;
  return h('button', {
    type: 'button',
    class: `botao-jogador${estado.jogadorId === j.id ? ' ativo' : ''}${expulso ? ' expulso' : ''}`,
    disabled: expulso,
    'data-jogador': j.id,
    title: expulso ? `Expulso (${motivoExpulsao(sancao)}): já não pode jogar` : null,
    onclick: () => {
      estado.jogadorId = estado.jogadorId === j.id ? null : j.id;
      desenharTudo();
    },
  }, h('b', {}, j.numero), h('small', {}, nomeCurto(j.nome)), h('em', {}, expulso ? 'Expulso' : j.posicao), marca);
}

function desenharJogadores() {
  const jogadores = plantelDe(equipaAtacante())
    .filter((j) => j.posicao !== 'GR')
    .sort((a, b) => a.numero - b.numero);
  const grelha = document.getElementById('jogadores');
  grelha.dataset.lado = estado.lado;
  substituir(grelha, jogadores.length
    ? jogadores.map(botaoJogador)
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

// ---------------------------------------------------------------------
// Defesa do adversário (guardada no tablet: sobrevive a recarregar a página)
// ---------------------------------------------------------------------
function lerSistemas() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CHAVE_SISTEMAS));
    if (guardado && typeof guardado === 'object' && !Array.isArray(guardado)) return guardado;
  } catch { /* sem armazenamento */ }
  return {};
}
function guardarSistemas() {
  try { localStorage.setItem(CHAVE_SISTEMAS, JSON.stringify(estado.sistemaPorEquipa)); } catch { /* ignora */ }
}
/** A defesa que a equipa adversária (a que defende) está a jogar, ou null se ainda não foi escolhida. */
const sistemaAtual = () => estado.sistemaPorEquipa[equipaAdversaria()] ?? null;

function escolherSistema(codigo) {
  const defensora = equipaAdversaria();
  if (estado.sistemaPorEquipa[defensora] === codigo) delete estado.sistemaPorEquipa[defensora];   // tocar outra vez tira
  else estado.sistemaPorEquipa[defensora] = codigo;
  guardarSistemas();
  desenharSistemas();
}

function desenharSistemas() {
  const atual = sistemaAtual();
  substituir(document.getElementById('sistemas'), SISTEMAS_DEFENSIVOS.map((s) => h('button', {
    type: 'button', class: atual === s.codigo ? 'ativo' : '', 'aria-pressed': String(atual === s.codigo), 'data-sistema': s.codigo,
    title: atual === s.codigo ? 'Toca outra vez para tirar' : `O adversário defende em ${s.rotulo}. Só conta nos remates em ataque posicional.`,
    onclick: () => escolherSistema(s.codigo),
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

// O 7×6 tem o seu próprio botão (liga/desliga) e não aparece como um evento qualquer
const TIPOS_SETE_SEIS = ['SETE_SEIS_INICIO', 'SETE_SEIS_FIM'];
const seteSeisAtivo = (equipaId) => Boolean(estado.estatisticas?.numerica?.seteSeis?.find((e) => e.equipaId === equipaId)?.ativo);

function desenharOutros() {
  const tipos = estado.tipos.filter((t) => !t.eRemate && !TIPOS_SETE_SEIS.includes(t.codigo));
  const ligado = seteSeisAtivo(equipaAtacante());
  substituir(document.getElementById('outros'),
    tipos.map((t) => h('button', { type: 'button', disabled: estado.aEnviar, onclick: () => registarOutro(t) }, t.nome)),
    h('button', {
      type: 'button', id: 'btn-sete-seis', disabled: estado.aEnviar, class: `alternar${ligado ? ' ativo' : ''}`, 'aria-pressed': String(ligado),
      title: 'Marca quando a equipa que ataca troca o guarda-redes por um sétimo jogador de campo',
      onclick: alternarSeteSeis,
    }, ligado ? '7×6 ligado · desligar' : 'Ataque 7×6'));
}

/** Faixa por baixo do marcador: quem está em campo a menos e quanto falta a cada sanção, e quem ataca em 7×6. */
function desenharNumerica() {
  if (!estado.jogo) return;
  desenharFaixa(document.getElementById('faixa-numerica'), estado.estatisticas?.numerica, estado.jogo, segundosDeJogo());
}

function descreverEvento(e) {
  const quem = e.jogadorNumero != null ? `#${e.jogadorNumero} ${e.jogadorNome}` : '';
  const lado = e.equipaId === estado.jogo.casaId ? 'casa' : 'fora';
  return h('li', { class: e.pendente ? 'pendente' : '', 'data-pendente': e.pendente ? 'sim' : null },
    h('span', { class: 'hora' }, `${e.parte}.ª ${formatarTempo(e.segundoJogo)}`),
    h('span', { class: 'texto' },
      h('span', { class: `ponto-equipa ${lado}` }),
      e.resultado
        ? [h('span', { class: 'etiqueta', 'data-resultado': e.resultado }, ROTULO_RESULTADO[e.resultado]), ' ', quem,
          e.balizaZona ? h('span', { class: 'zona-baliza' }, ` · ${ROTULO_ZONA_BALIZA[e.balizaZona]}`) : null]
        : [h('span', { class: 'etiqueta neutra' }, e.tipoNome), ' ', quem],
      e.pendente ? h('span', { class: 'etiqueta por-enviar', title: 'Ainda não chegou ao servidor: segue sozinho quando houver rede' }, '⏳ por enviar') : null),
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
// Janela da baliza (onde entrou o golo ou onde o guarda-redes defendeu)
// ---------------------------------------------------------------------
const janelaBaliza = document.getElementById('janela-baliza');
let resolverJanela = null;
let focoAntes = null;

criarBaliza(document.getElementById('baliza'), {
  aoClicar: ({ x, y }) => fecharJanelaBaliza({ x, y }),
});

/** Os textos da janela da baliza, conforme o resultado do remate. */
const TEXTOS_JANELA_BALIZA = {
  GOLO: {
    titulo: 'Onde entrou o golo?',
    sub: (gr) => (gr ? `Golo contra o guarda-redes #${gr.numero} ${gr.nome}` : 'Sem guarda-redes escolhido'),
    nota: 'Toca na baliza, vista de frente do lado de quem remata, no sítio onde a bola entrou.',
  },
  DEFESA: {
    titulo: 'Onde defendeu o guarda-redes?',
    sub: (gr) => (gr ? `Guarda-redes adversário: #${gr.numero} ${gr.nome}` : 'Sem guarda-redes escolhido'),
    nota: 'Toca na baliza, vista de frente do lado de quem remata, no sítio onde a bola foi defendida.',
  },
};

/** Abre a janela (resultado: 'GOLO' ou 'DEFESA'). Devolve {x, y} se tocou na baliza, null se escolheu "sem local" e undefined se cancelou. */
function pedirLocalNaBaliza(resultado, guardaRedes) {
  return new Promise((resolve) => {
    resolverJanela = resolve;
    focoAntes = document.activeElement;
    const textos = TEXTOS_JANELA_BALIZA[resultado];
    document.getElementById('titulo-baliza').textContent = textos.titulo;
    document.getElementById('sub-baliza').textContent = textos.sub(guardaRedes);
    document.getElementById('nota-baliza').textContent = textos.nota;
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

// Depois de registar, os botões ficam um instante parados: um toque duplo não regista duas vezes
const BLOQUEIO_MS = 250;

/**
 * Regista um evento: fica guardado no tablet e aparece logo no banco; o envio ao servidor não bloqueia nada
 * (sem rede, espera e segue sozinho quando ela voltar). `limpar` desfaz a escolha de mapa, jogador e situação.
 */
function registar(corpo, mensagem, { limpar = true } = {}) {
  fila.adicionar(jogoId, corpo);
  if (limpar) {
    estado.jogadorId = null;
    estado.ponto = null;
    estado.situacao = 'POSICIONAL';
  }
  estado.aEnviar = true;
  setTimeout(() => { estado.aEnviar = false; desenharResultados(); desenharOutros(); }, BLOQUEIO_MS);
  avisar(`${mensagem}${navigator.onLine ? '' : ' · sem rede: guardado no tablet'}`);
  recalcular();
  desenharTudo();
  envio.tentar();
}

async function registarRemate(resultado) {
  if (estado.aEnviar || estado.aEscolherBaliza) return;
  if (!estado.ponto || !estado.jogadorId) {
    avisar(!estado.ponto ? 'Toca primeiro no mapa.' : 'Escolhe o jogador.', { erro: true });
    return;
  }
  const jogador = estado.jogo.jogadores.find((j) => j.id === estado.jogadorId);
  if (sancaoDe(jogador.id)?.expulso) {
    avisar(`#${jogador.numero} ${jogador.nome} está expulso.`, { erro: true });
    return;
  }
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
  // A defesa do adversário só conta contra uma defesa montada: no contra-ataque e nos 7 metros não se envia
  if (estado.situacao === 'POSICIONAL' && sistemaAtual()) corpo.sistemaDefensivo = sistemaAtual();
  let descricao = `${ROTULO_RESULTADO[resultado]} · #${jogador.numero} ${jogador.nome}`;

  // Num golo ou numa defesa, abre a baliza para marcar onde a bola entrou ou onde o guarda-redes a defendeu
  if (resultado === 'GOLO' || resultado === 'DEFESA') {
    estado.aEscolherBaliza = true;
    const escolha = await pedirLocalNaBaliza(resultado, guardaRedes);
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

/** O que acontece ao jogador com esta sanção (para o aviso depois de registar), ou '' se continua em jogo. */
function consequencia(tipo, jogador) {
  if (!jogador) return '';
  if (tipo.codigo === 'VERMELHO') return ' · expulso';
  if (tipo.codigo === 'DOIS_MINUTOS' && (sancaoDe(jogador.id)?.doisMinutos ?? 0) + 1 >= 3) return ' · expulso (3.º 2 minutos)';
  return '';
}

function registarOutro(tipo) {
  if (estado.aEnviar) return;
  const jogador = estado.jogo.jogadores.find((j) => j.id === estado.jogadorId);
  if (tipo.codigo === 'VERMELHO' && !jogador) {
    avisar('Escolhe o jogador que viu o vermelho.', { erro: true });
    return;
  }
  // Os 2 minutos só se contam com o relógio a andar
  const semRelogio = ['DOIS_MINUTOS', 'VERMELHO'].includes(tipo.codigo) && segundosDeJogo() === 0 ? ' · inicia o relógio para contar os 2 minutos' : '';
  const corpo = { ...corpoBase(tipo.codigo), jogadorId: jogador?.id ?? null };
  registar(corpo, `${tipo.nome}${jogador ? ` · #${jogador.numero} ${jogador.nome}` : ''}${consequencia(tipo, jogador)}${semRelogio}`);
  if (tipo.codigo === 'TIMEOUT') iniciarTimeout(corpo.equipaId);   // o evento leva o segundo em que o relógio estava; só depois pára
}

/** Liga ou desliga o ataque 7×6 da equipa que está a atacar (não mexe no jogador nem no ponto escolhidos). */
function alternarSeteSeis() {
  if (estado.aEnviar) return;
  const ligado = seteSeisAtivo(equipaAtacante());
  registar({ ...corpoBase(ligado ? 'SETE_SEIS_FIM' : 'SETE_SEIS_INICIO'), jogadorId: null },
    ligado ? '7×6 desligado.' : 'Ataque 7×6 ligado.', { limpar: false });
}

async function apagarEvento(evento) {
  const descricao = evento.resultado
    ? `${ROTULO_RESULTADO[evento.resultado]} de #${evento.jogadorNumero}`
    : evento.tipoNome;
  if (!confirm(`Apagar "${descricao}" (${formatarTempo(evento.segundoJogo)})?`)) return;

  // Ainda por enviar: basta tirá-lo da fila, o servidor nunca o chegou a ver
  if (evento.pendente) {
    if (fila.remover(evento.clienteId)) {
      recalcular();
      desenharTudo();
      if (evento.tipo === 'TIMEOUT') terminarTimeout();
      avisar('Evento apagado (ainda não tinha sido enviado).');
    } else {
      avisar('Este evento acabou de ser enviado: tenta apagar outra vez daqui a pouco.', { erro: true });
    }
    return;
  }
  try {
    await enviar('DELETE', `/api/jogos/${jogoId}/eventos/${evento.id}`);
    // Se acabou de ser enviado também está nos «confirmados»: sem isto voltava a aparecer como se ainda estivesse por enviar
    if (evento.clienteId) {
      estado.confirmados = estado.confirmados.filter((c) => c.item.clienteId !== evento.clienteId);
      recalcular();
      desenharTudo();
    }
    if (evento.tipo === 'TIMEOUT') terminarTimeout();   // enganou-se no time-out: o minuto deixa de contar
    avisar('Evento apagado.');
    if (!estado.ligado) await atualizarPorHttp();
  } catch (erro) {
    avisar(erro.status == null
      ? 'Sem ligação ao servidor: só dá para apagar os eventos que ainda estão por enviar.'
      : `Não foi possível apagar: ${erro.message}`, { erro: true });
  }
}

/** Estatísticas que o banco mostra: as do servidor mais os eventos que ainda não chegaram lá. */
function recalcular() {
  if (!estado.jogo) return;
  const agora = Date.now();
  estado.confirmados = estado.confirmados.filter((c) => c.ate > agora);
  const pendentes = [...estado.confirmados.map((c) => c.item), ...fila.doJogo(jogoId)];
  estado.estatisticas = aplicarPendentes(estado.estatisticasServidor, pendentes, { jogo: estado.jogo, tipos: estado.tipos });
}

function receberEstatisticas(estatisticas) {
  estado.estatisticasServidor = estatisticas;
  guardarCache();
  recalcular();
  // Se o jogador escolhido acabou de ser expulso (aqui ou noutro tablet), deixa de estar escolhido
  if (estado.jogadorId && sancaoDe(estado.jogadorId)?.expulso) estado.jogadorId = null;
  desenharTudo();
}

async function atualizarPorHttp() {
  receberEstatisticas(await obter(`/api/jogos/${jogoId}/estatisticas`));
}

// ---------------------------------------------------------------------
// Sem rede: o jogo, os tipos e as últimas estatísticas ficam guardados no tablet para abrir o banco sem ligação
// ---------------------------------------------------------------------
const CHAVE_CACHE = chaveCacheBanco(jogoId);

function guardarCache() {
  if (!estado.jogo) return;
  try {
    localStorage.setItem(CHAVE_CACHE, JSON.stringify({
      jogo: estado.jogo, tipos: estado.tipos, estatisticas: resumoParaGuardar(estado.estatisticasServidor),
    }));
  } catch { /* sem armazenamento: o banco só não abre sem rede */ }
}

function lerCache() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CHAVE_CACHE));
    return guardado?.jogo && guardado.tipos ? guardado : null;
  } catch {
    return null;
  }
}

/** Um pedido que não responde em tempo útil conta como falta de rede (a rede de um pavilhão arrasta-se). */
function comTempoLimite(promessa, ms = 6000) {
  return Promise.race([promessa, esperar(ms).then(() => { throw new Error('O servidor não respondeu.'); })]);
}

async function carregarJogo() {
  try {
    [estado.jogo, estado.tipos] = await Promise.all([
      comTempoLimite(obter(`/api/jogos/${jogoId}`)),
      comTempoLimite(obter('/api/tipos-evento')),
    ]);
    guardarCache();
  } catch (erro) {
    // Só a falta de rede é desculpa para usar o que está guardado; um erro do servidor (jogo apagado...) não
    const guardado = erro.status == null ? lerCache() : null;
    if (!guardado) throw erro;
    estado.jogo = guardado.jogo;
    estado.tipos = guardado.tipos;
    estado.estatisticasServidor = guardado.estatisticas;
    avisar('Sem rede: o banco abriu com os dados guardados neste tablet. O que registares fica guardado e segue quando houver rede.', { duracao: 8000 });
  }
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
document.getElementById('btn-relogio').addEventListener('click', alternarRelogio);
document.getElementById('btn-fim-timeout').addEventListener('click', () => terminarTimeout({ retomar: true }));
document.getElementById('btn-parte').addEventListener('click', alternarParte);
document.getElementById('btn-ajustar').addEventListener('click', ajustarRelogio);
document.getElementById('btn-desfazer').addEventListener('click', () => {
  const ultimo = estado.estatisticas?.ultimosEventos?.[0];
  if (ultimo) apagarEvento(ultimo);
});

function desenharLigacao() {
  const semRede = !navigator.onLine;
  const codigo = semRede ? 'erro' : estado.codigoLigacao;
  const el = document.getElementById('ligacao');
  el.className = `ligacao ${codigo === 'ligado' ? 'ok' : codigo}`;
  el.textContent = semRede ? 'sem rede' : TEXTO_ESTADO[codigo];
}

function desenharPendentes() {
  const n = fila.doJogo(jogoId).length;
  const el = document.getElementById('pendentes');
  el.hidden = n === 0;
  el.textContent = `⏳ ${n} por enviar`;
  el.classList.toggle('a-enviar', envio.aCorrer && navigator.onLine);
}

function mostrarEstadoLigacao(codigo) {
  estado.ligado = codigo === 'ligado';
  estado.codigoLigacao = codigo;
  desenharLigacao();
  if (estado.ligado) envio.tentar();   // voltou a ligação: envia o que ficou à espera
}

const envio = criarEnvio({
  fila,
  enviar: (item) => enviar('POST', `/api/jogos/${item.jogoId}/eventos`, item.corpo),
  aoEnviar: (item) => {
    // Já está no servidor, mas as estatísticas dele ainda podem não o trazer: continua a contar até chegarem
    if (item.jogoId === jogoId) estado.confirmados.push({ item, ate: Date.now() + CONFIRMADO_ATE_CHEGAR_MS });
  },
  aoRejeitar: (item, erro) => {
    avisar(`Um evento não foi aceite pelo servidor e foi descartado: ${erro.message}`, { erro: true, duracao: 8000 });
  },
  aoTerminar: async (resultado) => {
    recalcular();
    desenharTudo();
    if (resultado?.enviados && !estado.ligado) {
      try { await atualizarPorHttp(); } catch { /* sem rede outra vez: a próxima tentativa trata disto */ }
    }
  },
});

window.addEventListener('online', () => { desenharLigacao(); envio.tentar(); });
window.addEventListener('offline', () => { desenharLigacao(); desenharPendentes(); });

setInterval(desenharRelogio, 500);
desenharRelogio();
setInterval(() => { if (relogio.iniciadoEm) sincronizarRelogio(); }, 30000);
setInterval(() => { if (fila.contar() > 0) envio.tentar(); }, 15000);   // rede de segurança: a fila nunca fica esquecida
if (relogio.iniciadoEm || relogio.acumuladoMs > 0) sincronizarRelogio(); // recarregou a página: volta a dizer ao servidor onde vai o relógio

try {
  await carregarJogo();
  document.title = `${estado.jogo.casaNome} vs ${estado.jogo.foraNome} · Banco`;
  recalcular();
  desenharTudo();
  desenharLigacao();
  ligar(jogoId, null, receberEstatisticas, mostrarEstadoLigacao);
  if (fila.contar() > 0) envio.tentar();   // abriu o banco com eventos de antes por enviar
} catch (erro) {
  substituir(document.querySelector('main'),
    h('p', { class: 'vazio' }, `Não foi possível carregar o jogo: ${erro.message}`),
    h('a', { href: './' }, '← Voltar à lista de jogos'));
}
