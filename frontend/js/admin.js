// Administração: as contas (editar, desativar, papel, repor a palavra-passe, eliminar), os jogos de todas as contas
// (terminar, reabrir, apagar) e o registo de alterações. Eliminar e apagar guardam antes uma cópia de segurança (JSON).
// Só abre para admins; a API volta a conferir tudo (/api/admin). As regras de quem pode fazer o quê estão em
// admin-calculos.js (testado à parte); aqui só se desenha.
import { h, substituir, avisar } from './dom.js';
import { obter, enviar, obterFicheiro } from './api.js';
import { exigirConta } from './conta.js';
import {
  ESTADOS, PAPEIS, FILTROS_CONTAS, FILTROS_JOGOS, FILTROS_REGISTO,
  acoesDaConta, acoesDoJogo, avisoDaAcao, avisoDaEdicao, avisoDoEmailDeTeste, avisoDoJogo, confirmacao, confirmacaoDoJogo, contarContas, descreverEmail,
  descreverUltimoAcesso, emailConfere, erroDaEdicao, filtrarContas, filtrarJogos, filtrarRegisto, ligacaoDosEventos, nomeDoFicheiro,
} from './admin-calculos.js';

const conta = await exigirConta();
const conteudo = document.getElementById('conteudo');
const sub = document.getElementById('sub');
const abas = [...document.querySelectorAll('#abas a')];

const ABAS = {
  utilizadores: {
    titulo: 'Utilizadores',
    sub: 'Todas as contas da app. Editar muda o nome e o email (um email novo deixa a conta por confirmar). Desativar termina logo a sessão e impede a entrada; os jogos e as equipas ficam como estão. Exportar guarda uma cópia de segurança da conta. Eliminar guarda essa cópia e apaga a conta e tudo o que é dela, e não se desfaz. A palavra-passe nunca se vê: repor envia à pessoa uma ligação para escolher outra.',
  },
  jogos: {
    titulo: 'Jogos',
    sub: 'Os jogos de todas as contas. Abre um jogo para corrigir ou apagar eventos; aqui também se termina, reabre, exporta (cópia de segurança) e apaga um jogo, e apagar guarda antes essa cópia. Cada alteração fica no registo.',
  },
  registo: {
    titulo: 'Registo de alterações',
    sub: 'O que os admins mudaram: contas, jogos e eventos de jogos, do mais recente para o mais antigo.',
  },
};

const estado = {
  aba: 'utilizadores',
  contas: null,
  email: null,
  edicao: null,   // a conta que se está a editar: { id, nome, email, erro }
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

/** Pergunta antes de agir. Eliminar não se desfaz: pede-se o email da conta, escrito (a API volta a conferi-lo). */
function confirmar(acao, c) {
  if (acao !== 'eliminar') return confirm(confirmacao(acao, c));
  const escrito = prompt(confirmacao(acao, c));
  if (escrito === null) return false;
  if (!emailConfere(escrito, c)) {
    avisar('O email escrito não é o da conta: não foi eliminada.', { erro: true, duracao: 6000 });
    return false;
  }
  return true;
}

/**
 * Guarda no computador a cópia de segurança (JSON) que a API dá em `url` e devolve o nome do ficheiro.
 * O browser descarrega-a sozinho, como se se clicasse numa ligação.
 */
async function guardarCopia(url, nomePadrao) {
  const { blob, disposicao } = await obterFicheiro(url);
  const nome = nomeDoFicheiro(disposicao, nomePadrao);
  const endereco = URL.createObjectURL(blob);
  const ligacao = document.createElement('a');
  ligacao.href = endereco;
  ligacao.download = nome;
  ligacao.style.display = 'none';
  document.body.append(ligacao);
  ligacao.click();
  ligacao.remove();
  setTimeout(() => URL.revokeObjectURL(endereco), 30000);
  return nome;
}

/** A cópia que antecede uma ação que não se desfaz: se não se conseguir guardar, a ação não avança. */
async function copiaAntes(url, nomePadrao) {
  try {
    return await guardarCopia(url, nomePadrao);
  } catch (erro) {
    throw new Error(`a cópia de segurança falhou (${erro.message}), por isso nada foi apagado.`);
  }
}

/** Faz uma ação a uma conta: confirma, (se pedido) guarda a cópia de segurança, envia, volta a ler a lista e avisa. */
async function fazer(acao, c, executar, { copia = null } = {}) {
  if (estado.ocupado) return;
  if (!confirmar(acao, c)) return;
  estado.ocupado = true;
  desenharLista();
  try {
    const ficheiro = copia ? await copiaAntes(copia, `conta-${c.id}.json`) : null;
    await executar();
    estado.contas = await obter('/api/admin/utilizadores');
    avisar(avisoDaAcao(acao, c, ficheiro), { duracao: ficheiro ? 9000 : null });
  } catch (erro) {
    avisar(`Não foi possível: ${erro.message}`, { erro: true, duracao: 6000 });
  } finally {
    estado.ocupado = false;
    desenhar();
  }
}

/** Só guarda a cópia de segurança de uma conta, sem mudar nada. */
async function exportarConta(c) {
  if (estado.ocupado) return;
  estado.ocupado = true;
  desenharLista();
  try {
    const ficheiro = await guardarCopia(`/api/admin/utilizadores/${c.id}/exportar`, `conta-${c.id}.json`);
    avisar(`Cópia de segurança guardada: ${ficheiro}.`, { duracao: 7000 });
  } catch (erro) {
    avisar(`Não foi possível exportar: ${erro.message}`, { erro: true, duracao: 6000 });
  } finally {
    estado.ocupado = false;
    desenharLista();
  }
}

// ---- editar o nome e o email de uma conta (uma linha com o formulário no lugar da linha da conta)
function abrirEdicao(c) {
  estado.edicao = { id: c.id, nome: c.nome, email: c.email, erro: null };
  desenharLista();
  document.getElementById('edicao-nome')?.focus();
}

function fecharEdicao() {
  estado.edicao = null;
  desenharLista();
}

async function guardarEdicao(c) {
  const e = estado.edicao;
  if (!e || estado.ocupado) return;
  e.erro = erroDaEdicao(e, c);
  if (e.erro) return desenharLista();

  estado.ocupado = true;
  desenharLista();
  const email = e.email.trim().toLowerCase();
  try {
    const resposta = await enviar('PUT', `/api/admin/utilizadores/${c.id}`, { nome: e.nome.trim(), email });
    estado.edicao = null;
    estado.contas = await obter('/api/admin/utilizadores');
    avisar(avisoDaEdicao(resposta, c, email), { duracao: 9000 });
  } catch (erro) {
    e.erro = erro.message;   // fica o formulário aberto, com o que se escreveu e a razão
  } finally {
    estado.ocupado = false;
    desenharLista();
  }
}

function linhaEdicao(c) {
  const e = estado.edicao;
  const campo = (rotulo, id, tipo, chave, extra = {}) => h('label', { for: id },
    rotulo,
    h('input', {
      id, type: tipo, value: e[chave], autocomplete: 'off', disabled: estado.ocupado, ...extra,
      oninput: (ev) => { e[chave] = ev.target.value; },
    }));
  return h('tr', { class: 'linha-edicao', 'data-conta-id': c.id, 'data-email': c.email },
    h('td', { colspan: 8, class: 'celula-edicao' },
      h('form', { class: 'form-edicao', id: 'form-edicao', novalidate: true, onsubmit: (ev) => { ev.preventDefault(); guardarEdicao(c); } },
        campo('Nome', 'edicao-nome', 'text', 'nome', { maxlength: 80 }),
        campo('Email', 'edicao-email', 'email', 'email', { maxlength: 160 }),
        h('p', { class: 'nota-edicao' },
          'Se mudares o email, a conta fica por confirmar: termina as sessões, anula os links antigos e enviamos a ligação de confirmação para o email novo.'),
        e.erro ? h('p', { class: 'erro-edicao', id: 'erro-edicao', role: 'alert' }, e.erro) : null,
        h('div', { class: 'acoes-edicao' },
          h('button', { type: 'submit', class: 'botao primario pequeno', id: 'edicao-guardar', disabled: estado.ocupado }, 'Guardar'),
          h('button', { type: 'button', class: 'botao suave pequeno', id: 'edicao-cancelar', disabled: estado.ocupado, onclick: fecharEdicao }, 'Cancelar')))));
}

function botoesDaConta(c) {
  const a = acoesDaConta(c, conta.id);
  if (a.propria) return h('span', { class: 'texto-suave' }, 'A tua conta');
  const base = `/api/admin/utilizadores/${c.id}`;
  const botao = (rotulo, acao, aoClicar, classe = 'suave') => h('button', {
    type: 'button', class: `botao ${classe} pequeno`, 'data-acao': acao, disabled: estado.ocupado, onclick: aoClicar,
  }, rotulo);
  const acao = (rotulo, nome, executar, classe, opcoes) => botao(rotulo, nome, () => fazer(nome, c, executar, opcoes), classe);
  return h('div', { class: 'acoes-linha' },
    a.editar ? botao('Editar', 'editar', () => abrirEdicao(c)) : null,
    a.exportar ? botao('Exportar', 'exportar', () => exportarConta(c)) : null,
    a.repor ? acao('Repor palavra-passe', 'repor', () => enviar('POST', `${base}/repor-palavra-passe`)) : null,
    a.papel === 'admin' ? acao('Tornar admin', 'admin', () => enviar('PUT', `${base}/papel`, { papel: 'admin' })) : null,
    a.papel === 'normal' ? acao('Tirar admin', 'normal', () => enviar('PUT', `${base}/papel`, { papel: 'normal' })) : null,
    a.ativa === false ? acao('Desativar', 'desativar', () => enviar('PUT', `${base}/ativa`, { ativa: false }), 'perigo') : null,
    a.ativa === true ? acao('Ativar', 'ativar', () => enviar('PUT', `${base}/ativa`, { ativa: true }), 'primario') : null,
    a.eliminar
      ? acao('Eliminar', 'eliminar', () => enviar('POST', `${base}/eliminar`, { email: c.email }), 'perigo', { copia: `${base}/exportar` })
      : null);
}

function linhaConta(c) {
  return h('tr', { 'data-conta-id': c.id, 'data-email': c.email, class: c.estado === 'desativado' ? 'desativada' : null },
    h('td', { class: 'nome', title: `Conta criada em ${dia(c.criadoEm)}` },
      h('strong', {}, c.nome), c.id === conta.id ? h('span', { class: 'etiqueta neutra tu' }, 'Tu') : null),
    h('td', { class: 'email' }, c.email),
    h('td', { class: 'equipa', 'data-rotulo': 'Equipa' }, c.equipa ?? h('span', { class: 'texto-suave' }, '–')),
    h('td', { class: 'num', 'data-rotulo': 'Jogos' }, c.jogos),
    h('td', { class: 'acesso', 'data-rotulo': 'Último acesso', title: c.ultimoAcessoEm ? dataCurta(c.ultimoAcessoEm) : 'Ainda sem registo de acesso' },
      descreverUltimoAcesso(c.ultimoAcessoEm)),
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
        ['Nome', ''], ['Email', ''], ['Equipa', ''], ['Jogos', 'num'], ['Último acesso', ''], ['Papel', ''], ['Estado', ''], ['', ''],
      ].map(([t, classe]) => h('th', { scope: 'col', class: classe || null }, t)))),
      h('tbody', {}, visiveis.map((c) => (estado.edicao?.id === c.id ? linhaEdicao(c) : linhaConta(c))))));
}

/** Os emails chegam a alguém? A faixa diz como estão e deixa mandar um email de teste ao próprio admin. */
async function testarEmail() {
  if (estado.ocupado) return;
  estado.ocupado = true;
  desenhar();
  try {
    await enviar('POST', '/api/admin/email/testar');
    avisar(avisoDoEmailDeTeste(estado.email, conta.email), { duracao: 9000 });
  } catch (erro) {
    avisar(erro.message, { erro: true, duracao: 9000 });
  } finally {
    estado.ocupado = false;
    desenhar();
  }
}

function faixaEmail() {
  const d = descreverEmail(estado.email);
  if (!d) return null;
  return h('div', { class: `aviso-inline ${d.nivel === 'ok' ? 'ok' : ''} faixa-email`, id: 'faixa-email', 'data-modo': estado.email.modo },
    h('strong', {}, d.titulo), ' ', d.detalhe, ' ',
    d.podeTestar
      ? h('button', { type: 'button', class: 'botao suave pequeno', id: 'testar-email', disabled: estado.ocupado, onclick: testarEmail }, 'Enviar email de teste para mim')
      : null);
}

function vistaUtilizadores() {
  const n = contarContas(estado.contas);
  return [
    faixaEmail(),
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
/** Faz uma ação a um jogo (terminar, reabrir, apagar): confirma, guarda a cópia antes de apagar, envia e volta a ler a lista. */
async function fazerJogo(acao, j, executar, { copia = null } = {}) {
  if (estado.ocupado) return;
  if (!confirm(confirmacaoDoJogo(acao, j))) return;
  estado.ocupado = true;
  desenharLista();
  try {
    const ficheiro = copia ? await copiaAntes(copia, `jogo-${j.id}.json`) : null;
    await executar();
    estado.jogos = await obter('/api/admin/jogos');
    avisar(avisoDoJogo(acao, j, ficheiro), { duracao: ficheiro ? 9000 : null });
  } catch (erro) {
    avisar(`Não foi possível: ${erro.message}`, { erro: true, duracao: 6000 });
  } finally {
    estado.ocupado = false;
    desenhar();
  }
}

/** Só guarda a cópia de segurança de um jogo, sem mudar nada. */
async function exportarJogo(j) {
  if (estado.ocupado) return;
  estado.ocupado = true;
  desenharLista();
  try {
    const ficheiro = await guardarCopia(`/api/admin/jogos/${j.id}/exportar`, `jogo-${j.id}.json`);
    avisar(avisoDoJogo('exportar', j, ficheiro), { duracao: 7000 });
  } catch (erro) {
    avisar(`Não foi possível exportar: ${erro.message}`, { erro: true, duracao: 6000 });
  } finally {
    estado.ocupado = false;
    desenharLista();
  }
}

function botoesDoJogo(j) {
  const a = acoesDoJogo(j);
  const base = `/api/admin/jogos/${j.id}`;
  const botao = (rotulo, acao, aoClicar, classe = 'suave') => h('button', {
    type: 'button', class: `botao ${classe} pequeno`, 'data-acao': acao, disabled: estado.ocupado, onclick: aoClicar,
  }, rotulo);
  return h('div', { class: 'acoes-linha' },
    h('a', { class: 'botao-link suave pequeno', href: ligacaoDosEventos(j.id), 'data-acao': 'eventos' }, 'Eventos'),
    a.exportar ? botao('Exportar', 'exportar', () => exportarJogo(j)) : null,
    a.terminar ? botao('Terminar', 'terminar', () => fazerJogo('terminar', j, () => enviar('PUT', `${base}/terminado`, { terminado: true }))) : null,
    a.reabrir ? botao('Reabrir', 'reabrir', () => fazerJogo('reabrir', j, () => enviar('PUT', `${base}/terminado`, { terminado: false }))) : null,
    a.apagar ? botao('Apagar', 'apagar', () => fazerJogo('apagar', j, () => enviar('DELETE', base), { copia: `${base}/exportar` }), 'perigo') : null);
}

function linhaJogo(j) {
  return h('tr', { 'data-jogo-id': j.id },
    h('td', { class: 'data' }, dataCurta(j.dataHora)),
    h('td', { class: 'jogo' },
      h('strong', {}, `${j.casaNome} ${j.golosCasa} – ${j.golosFora} ${j.foraNome}`),
      j.terminadoEm ? h('span', { class: 'etiqueta terminado' }, 'Terminado') : null,
      j.local ? h('small', { class: 'texto-suave' }, j.local) : null),
    h('td', { class: 'dono', 'data-rotulo': 'Conta' }, j.donoNome ?? h('span', { class: 'texto-suave' }, 'Sem conta')),
    h('td', { class: 'num', 'data-rotulo': 'Eventos' }, j.eventos),
    h('td', { class: 'acoes-conta' }, botoesDoJogo(j)));
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
    if (aba === 'utilizadores' && !estado.email) estado.email = await obter('/api/admin/email').catch(() => null);   // a faixa é um extra: sem ela a página funciona
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
