// Administração: as contas (desativar, papel, repor a palavra-passe), os jogos de todas as contas e o registo de
// alterações. Só abre para admins; a API volta a conferir tudo (/api/admin). As regras de quem pode fazer o quê
// estão em admin-calculos.js (testado à parte); aqui só se desenha.
import { h, substituir, avisar } from './dom.js';
import { obter, enviar } from './api.js';
import { exigirConta } from './conta.js';
import {
  ESTADOS, PAPEIS, FILTROS_CONTAS, FILTROS_JOGOS, FILTROS_REGISTO,
  acoesDaConta, avisoDaAcao, confirmacao, contarContas, filtrarContas, filtrarJogos, filtrarRegisto, ligacaoDosEventos,
} from './admin-calculos.js';

const conta = await exigirConta();
const conteudo = document.getElementById('conteudo');
const sub = document.getElementById('sub');
const abas = [...document.querySelectorAll('#abas a')];

const ABAS = {
  utilizadores: {
    titulo: 'Utilizadores',
    sub: 'Todas as contas da app. Desativar termina logo a sessão e impede a entrada; os jogos e as equipas ficam como estão. A palavra-passe nunca se vê: repor envia à pessoa uma ligação para escolher outra.',
  },
  jogos: {
    titulo: 'Jogos',
    sub: 'Os jogos de todas as contas. Abre um jogo para corrigir ou apagar eventos: cada alteração fica no registo.',
  },
  registo: {
    titulo: 'Registo de alterações',
    sub: 'O que os admins mudaram: contas e eventos de jogos, do mais recente para o mais antigo.',
  },
};

const estado = {
  aba: 'utilizadores',
  contas: null,
  jogos: null,
  registo: null,
  tipoRegisto: '',
  pesquisa: { utilizadores: '', jogos: '', registo: '' },
  filtro: { utilizadores: 'todas', jogos: 'todos' },
  ocupado: false,
};

const dataCurta = (iso) => (iso ? new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '–');
const dia = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-PT', { dateStyle: 'medium' }) : '–');

// ---------------------------------------------------------------------
// Peças comuns
// ---------------------------------------------------------------------
function botaoFiltro(rotulo, ativo, aoClicar, extra = {}) {
  return h('button', { type: 'button', class: ativo ? 'ativo' : '', 'aria-pressed': ativo ? 'true' : 'false', onclick: aoClicar, ...extra }, rotulo);
}

/** A barra de cima de cada separador: filtros à esquerda e a pesquisa. Só se redesenha a lista, para não perder o foco da pesquisa. */
function barra({ filtros, atual, aoFiltrar, aba, pesquisar, aoPesquisar, placeholder }) {
  const campo = h('input', {
    type: 'search', class: 'admin-pesquisa', value: pesquisar, placeholder, 'aria-label': placeholder, autocomplete: 'off',
    'data-pesquisa': aba, oninput: (ev) => aoPesquisar(ev.target.value),
  });
  return h('div', { class: 'admin-barra' },
    h('div', { class: 'separador-abas', role: 'group', 'aria-label': 'Filtro' },
      filtros.map((f) => botaoFiltro(f.rotulo, f.codigo === atual, () => aoFiltrar(f.codigo), { 'data-filtro': f.codigo || 'tudo' }))),
    campo);
}

function carregando(texto = 'A carregar…') {
  return h('p', { class: 'vazio', id: 'a-carregar' }, texto);
}

function falhou(erro, aoTentar) {
  return h('div', { class: 'aviso-inline erro', role: 'alert', id: 'erro-admin' },
    `Não foi possível carregar: ${erro.message} `,
    h('button', { type: 'button', class: 'botao suave pequeno', onclick: aoTentar }, 'Tentar outra vez'));
}

// ---------------------------------------------------------------------
// Utilizadores
// ---------------------------------------------------------------------
function numero(valor, rotulo, id) {
  return h('div', { class: 'numero', id }, h('b', {}, valor), h('span', {}, rotulo));
}

function etiquetaEstado(c) {
  return h('span', { class: `etiqueta estado-${c.estado}`, 'data-estado': c.estado }, ESTADOS[c.estado] ?? c.estado);
}

function etiquetaPapel(c) {
  return h('span', { class: `etiqueta papel-${c.papel}`, 'data-papel': c.papel }, PAPEIS[c.papel] ?? c.papel);
}

/** Faz uma ação a uma conta: confirma, envia, volta a ler a lista e avisa. */
async function fazer(acao, c, executar) {
  if (estado.ocupado) return;
  if (!confirm(confirmacao(acao, c))) return;
  estado.ocupado = true;
  desenharLista();
  try {
    await executar();
    estado.contas = await obter('/api/admin/utilizadores');
    avisar(avisoDaAcao(acao, c));
  } catch (erro) {
    avisar(`Não foi possível: ${erro.message}`, { erro: true, duracao: 6000 });
  } finally {
    estado.ocupado = false;
    desenhar();
  }
}

function botoesDaConta(c) {
  const a = acoesDaConta(c, conta.id);
  if (a.propria) return h('span', { class: 'texto-suave' }, 'A tua conta');
  const base = `/api/admin/utilizadores/${c.id}`;
  const botao = (rotulo, acao, executar, classe = 'suave') => h('button', {
    type: 'button', class: `botao ${classe} pequeno`, 'data-acao': acao, disabled: estado.ocupado, onclick: () => fazer(acao, c, executar),
  }, rotulo);
  return h('div', { class: 'acoes-linha' },
    a.repor ? botao('Repor palavra-passe', 'repor', () => enviar('POST', `${base}/repor-palavra-passe`)) : null,
    a.papel === 'admin' ? botao('Tornar admin', 'admin', () => enviar('PUT', `${base}/papel`, { papel: 'admin' })) : null,
    a.papel === 'normal' ? botao('Tirar admin', 'normal', () => enviar('PUT', `${base}/papel`, { papel: 'normal' })) : null,
    a.ativa === false ? botao('Desativar', 'desativar', () => enviar('PUT', `${base}/ativa`, { ativa: false }), 'perigo') : null,
    a.ativa === true ? botao('Ativar', 'ativar', () => enviar('PUT', `${base}/ativa`, { ativa: true }), 'primario') : null);
}

function linhaConta(c) {
  return h('tr', { 'data-conta-id': c.id, 'data-email': c.email, class: c.estado === 'desativado' ? 'desativada' : null },
    h('td', { class: 'nome', title: `Conta criada em ${dia(c.criadoEm)}` },
      h('strong', {}, c.nome), c.id === conta.id ? h('span', { class: 'etiqueta neutra tu' }, 'Tu') : null),
    h('td', { class: 'email' }, c.email),
    h('td', { class: 'equipa', 'data-rotulo': 'Equipa' }, c.equipa ?? h('span', { class: 'texto-suave' }, '–')),
    h('td', { class: 'num', 'data-rotulo': 'Jogos' }, c.jogos),
    h('td', {}, etiquetaPapel(c)),
    h('td', {}, etiquetaEstado(c)),
    h('td', { class: 'acoes-conta' }, botoesDaConta(c)));
}

function tabelaContas() {
  const visiveis = filtrarContas(estado.contas, { texto: estado.pesquisa.utilizadores, filtro: estado.filtro.utilizadores });
  if (visiveis.length === 0) return h('p', { class: 'vazio', id: 'sem-resultados' }, 'Nenhuma conta com estes filtros.');
  return h('div', { class: 'tabela-rolagem' },
    h('table', { class: 'tabela tabela-admin', id: 'tabela-contas' },
      h('thead', {}, h('tr', {}, [
        ['Nome', ''], ['Email', ''], ['Equipa', ''], ['Jogos', 'num'], ['Papel', ''], ['Estado', ''], ['', ''],
      ].map(([t, classe]) => h('th', { scope: 'col', class: classe || null }, t)))),
      h('tbody', {}, visiveis.map(linhaConta))));
}

function vistaUtilizadores() {
  const n = contarContas(estado.contas);
  return [
    h('div', { class: 'numeros', id: 'numeros-contas' },
      numero(n.total, 'contas', 'n-total'), numero(n.ativas, 'ativas', 'n-ativas'), numero(n.admins, 'admins', 'n-admins'),
      numero(n.porConfirmar, 'por confirmar', 'n-por-confirmar'), numero(n.desativadas, 'desativadas', 'n-desativadas')),
    barra({
      filtros: FILTROS_CONTAS, atual: estado.filtro.utilizadores, aba: 'utilizadores', pesquisar: estado.pesquisa.utilizadores,
      placeholder: 'Procurar por nome, email ou equipa',
      aoFiltrar: (f) => { estado.filtro.utilizadores = f; desenhar(); },
      aoPesquisar: (t) => { estado.pesquisa.utilizadores = t; desenharLista(); },
    }),
    h('div', { class: 'cartao admin-lista', id: 'lista' }, tabelaContas()),
  ];
}

// ---------------------------------------------------------------------
// Jogos
// ---------------------------------------------------------------------
function linhaJogo(j) {
  return h('tr', { 'data-jogo-id': j.id },
    h('td', { class: 'data' }, dataCurta(j.dataHora)),
    h('td', { class: 'jogo' },
      h('strong', {}, `${j.casaNome} ${j.golosCasa} – ${j.golosFora} ${j.foraNome}`),
      j.terminadoEm ? h('span', { class: 'etiqueta terminado' }, 'Terminado') : null,
      j.local ? h('small', { class: 'texto-suave' }, j.local) : null),
    h('td', { class: 'dono', 'data-rotulo': 'Conta' }, j.donoNome ?? h('span', { class: 'texto-suave' }, 'Sem conta')),
    h('td', { class: 'num', 'data-rotulo': 'Eventos' }, j.eventos),
    h('td', { class: 'acoes-conta' },
      h('a', { class: 'botao-link suave pequeno', href: ligacaoDosEventos(j.id), 'data-acao': 'eventos' }, 'Eventos')));
}

function tabelaJogos() {
  const visiveis = filtrarJogos(estado.jogos, { texto: estado.pesquisa.jogos, filtro: estado.filtro.jogos });
  if (visiveis.length === 0) return h('p', { class: 'vazio', id: 'sem-resultados' }, 'Nenhum jogo com estes filtros.');
  return [
    h('div', { class: 'tabela-rolagem' },
      h('table', { class: 'tabela tabela-admin tabela-jogos', id: 'tabela-jogos' },
        h('thead', {}, h('tr', {}, [['Data', ''], ['Jogo', ''], ['Conta', ''], ['Eventos', 'num'], ['', '']]
          .map(([t, classe]) => h('th', { scope: 'col', class: classe || null }, t)))),
        h('tbody', {}, visiveis.map(linhaJogo)))),
    estado.jogos.length >= 500 ? h('p', { class: 'texto-suave nota-limite' }, 'Mostra os 500 jogos mais recentes.') : null,
  ];
}

function vistaJogos() {
  return [
    barra({
      filtros: FILTROS_JOGOS, atual: estado.filtro.jogos, aba: 'jogos', pesquisar: estado.pesquisa.jogos,
      placeholder: 'Procurar por equipa, conta ou local',
      aoFiltrar: (f) => { estado.filtro.jogos = f; desenhar(); },
      aoPesquisar: (t) => { estado.pesquisa.jogos = t; desenharLista(); },
    }),
    h('div', { class: 'cartao admin-lista', id: 'lista' }, tabelaJogos()),
  ];
}

// ---------------------------------------------------------------------
// Registo
// ---------------------------------------------------------------------
function linhaRegisto(l) {
  return h('li', { class: 'registo-linha', 'data-registo-id': l.id, 'data-tipo': l.tipo },
    h('div', { class: 'registo-quando' }, dataCurta(l.quando)),
    h('div', { class: 'registo-corpo' },
      h('div', { class: 'registo-titulo' },
        h('span', { class: `etiqueta tipo-${l.tipo}` }, l.acao),
        h('span', { class: 'texto-suave' }, ` por ${l.autorNome}`)),
      h('p', { class: 'registo-detalhe' }, l.detalhe),
      l.jogoId != null ? h('a', { class: 'registo-ligacao', href: ligacaoDosEventos(l.jogoId) }, 'Abrir o jogo') : null));
}

function listaRegisto() {
  const visiveis = filtrarRegisto(estado.registo, estado.pesquisa.registo);
  if (estado.registo.length === 0) return h('p', { class: 'vazio', id: 'sem-registo' }, 'Ainda não há alterações registadas.');
  if (visiveis.length === 0) return h('p', { class: 'vazio', id: 'sem-resultados' }, 'Nenhuma alteração com estes filtros.');
  return h('ul', { class: 'registo-lista', id: 'registo' }, visiveis.map(linhaRegisto));
}

async function mudarTipoRegisto(tipo) {
  estado.tipoRegisto = tipo;
  estado.registo = null;
  await carregar();
}

function vistaRegisto() {
  return [
    barra({
      filtros: FILTROS_REGISTO, atual: estado.tipoRegisto, aba: 'registo', pesquisar: estado.pesquisa.registo,
      placeholder: 'Procurar por quem, ação ou detalhe',
      aoFiltrar: mudarTipoRegisto,
      aoPesquisar: (t) => { estado.pesquisa.registo = t; desenharLista(); },
    }),
    h('div', { class: 'cartao admin-lista', id: 'lista' }, listaRegisto()),
  ];
}

// ---------------------------------------------------------------------
// Separadores
// ---------------------------------------------------------------------
const dadosDa = { utilizadores: () => estado.contas, jogos: () => estado.jogos, registo: () => estado.registo };

function desenharLista() {
  const sitio = document.getElementById('lista');
  if (!sitio || dadosDa[estado.aba]() == null) return desenhar();
  const lista = estado.aba === 'utilizadores' ? tabelaContas() : estado.aba === 'jogos' ? tabelaJogos() : listaRegisto();
  substituir(sitio, lista);
  // os botões das contas mudam quando há uma ação a decorrer
  if (estado.aba === 'utilizadores') document.getElementById('lista')?.setAttribute('aria-busy', estado.ocupado ? 'true' : 'false');
}

function desenhar() {
  const aba = ABAS[estado.aba];
  document.title = `${aba.titulo} · Administração · Scouting de Andebol`;
  sub.textContent = aba.sub;
  abas.forEach((a) => {
    if (a.dataset.aba === estado.aba) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (dadosDa[estado.aba]() == null) return substituir(conteudo, carregando());
  const vista = { utilizadores: vistaUtilizadores, jogos: vistaJogos, registo: vistaRegisto }[estado.aba];
  substituir(conteudo, vista());
  conteudo.dataset.aba = estado.aba;
}

async function carregar() {
  const aba = estado.aba;
  desenhar();
  try {
    if (aba === 'utilizadores' && !estado.contas) estado.contas = await obter('/api/admin/utilizadores');
    if (aba === 'jogos' && !estado.jogos) estado.jogos = await obter('/api/admin/jogos');
    if (aba === 'registo' && !estado.registo) {
      estado.registo = await obter(`/api/admin/registo${estado.tipoRegisto ? `?tipo=${estado.tipoRegisto}` : ''}`);
    }
  } catch (erro) {
    if (aba === estado.aba) substituir(conteudo, falhou(erro, carregar));
    return;
  }
  if (aba === estado.aba) desenhar();
}

function abaDoEndereco() {
  const codigo = location.hash.replace(/^#/, '');
  return ABAS[codigo] ? codigo : 'utilizadores';
}

window.addEventListener('hashchange', () => {
  estado.aba = abaDoEndereco();
  // cada vez que se volta a um separador a lista é lida de novo (as alterações podem ter vindo de outro admin)
  estado[{ utilizadores: 'contas', jogos: 'jogos', registo: 'registo' }[estado.aba]] = null;
  carregar();
});

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
if (!conta) {
  sub.textContent = 'Não foi possível confirmar a tua conta agora.';
  substituir(conteudo, h('p', { class: 'vazio' }, 'Tenta outra vez daqui a pouco.'));
} else if (!conta.admin) {
  sub.textContent = 'Esta área é só para quem administra a app.';
  abas.forEach((a) => { a.hidden = true; });
  substituir(conteudo, h('a', { class: 'botao-link primario', href: './', id: 'sem-acesso' }, 'Voltar aos jogos'));
} else {
  estado.aba = abaDoEndereco();
  await carregar();
}
