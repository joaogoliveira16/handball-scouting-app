// Estatísticas dos jogadores da equipa da conta, somadas em todos os jogos registados. Clicar num jogador mostra jogo a jogo.
// As contas estão em estatisticas-jogadores.js (testado à parte); aqui só se desenha.
import { h, substituir, avisar } from './dom.js';
import { obter, ROTULO_POSICAO } from './api.js';
import { exigirConta } from './conta.js';
import { escudo } from './escudo.js';
import {
  estatisticasDaEquipa, filtrarJogos, evolucaoDaEquipa, seriesDoGrafico, serieDoJogador, categoriaDoJogo, GRAFICOS_EQUIPA, VISTAS, formatar, ordenar,
} from './estatisticas-jogadores.js';
import { graficoLinhas } from './grafico.js';

await exigirConta();

const raiz = document.getElementById('estatisticas');
const DATA = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });

const CORES_SERIES = ['var(--serie-1)', 'var(--serie-2)'];
const ULTIMOS = 5;   // «Últimos 5 jogos»

const estado = {
  equipa: null,       // a equipa da conta
  dadosPorParte: new Map(), // o que a API devolveu, por parte (null = jogo todo): a parte escolhe-se no servidor
  dados: null,        // os dados da parte escolhida, com todos os jogos
  resultado: null,    // o que estatisticasDaEquipa devolve (já com os filtros de local e de últimos jogos)
  evolucao: [],       // a equipa jogo a jogo (para os gráficos)
  local: 'todos',     // 'todos' | 'casa' | 'fora'
  parte: null,        // null (jogo todo) | 1 | 2
  ultimos: null,      // null (todos) | ULTIMOS
  grafico: GRAFICOS_EQUIPA[0],
  vista: VISTAS[0],
  chave: VISTAS[0].ordemInicial,
  direcao: 'desc',
  abertos: new Set(), // jogadores com o detalhe jogo a jogo aberto
};

const nomeDe = (j) => `#${j.numero} ${j.nome}`;

// ---------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------
function resumo(r) {
  const numero = (valor, rotulo, id) => h('div', { class: 'numero', id }, h('b', {}, valor), h('span', {}, rotulo));
  return h('div', { class: 'numeros', id: 'resumo-equipa' },
    numero(r.jogos, r.jogos === 1 ? 'jogo' : 'jogos', 'resumo-jogos'),
    numero(`${r.vitorias}-${r.empates}-${r.derrotas}`, 'vitórias-empates-derrotas', 'resumo-resultados'),
    numero(r.golosMarcados, 'golos marcados', 'resumo-golos'),
    numero(r.golosSofridos, 'golos sofridos', 'resumo-sofridos'));
}

function abas() {
  return h('div', { class: 'separador-abas', role: 'group', 'aria-label': 'O que ver' },
    VISTAS.map((v) => h('button', {
      type: 'button', class: v === estado.vista ? 'ativo' : '', 'aria-pressed': v === estado.vista ? 'true' : 'false',
      onclick: () => { estado.vista = v; estado.chave = v.ordemInicial; estado.direcao = 'desc'; desenhar(); },
    }, v.rotulo)));
}

function ordenarPor(chave) {
  if (estado.chave === chave) estado.direcao = estado.direcao === 'desc' ? 'asc' : 'desc';
  else { estado.chave = chave; estado.direcao = chave === 'numero' || chave === 'nome' ? 'asc' : 'desc'; }
  desenhar();
}

function cabecalhoOrdenavel(chave, rotulo, titulo, numerica) {
  const ativa = estado.chave === chave;
  return h('th', { class: numerica ? 'num' : '', scope: 'col', 'aria-sort': ativa ? (estado.direcao === 'asc' ? 'ascending' : 'descending') : 'none' },
    h('button', { type: 'button', class: 'ordenar', title: `${titulo}. Clica para ordenar`, onclick: () => ordenarPor(chave) }, rotulo));
}

function resultadoDoJogo(jogo) {
  const r = jogo.golos > jogo.golosAdversario ? 'V' : jogo.golos < jogo.golosAdversario ? 'D' : 'E';
  return h('span', { class: `resultado resultado-${r}` }, `${r} ${jogo.golos}–${jogo.golosAdversario}`);
}

/** A evolução de um jogador na vista escolhida (só com 2 jogos ou mais: com um não há evolução). */
function graficoDoJogador(jogador, vista) {
  if (jogador.porJogo.length < 2) return null;
  const { categorias, valores } = serieDoJogador(jogador, vista);
  return graficoLinhas({
    id: `grafico-jogador-${jogador.jogadorId}`, titulo: `${jogador.nome}: ${vista.grafico.titulo.charAt(0).toLowerCase()}${vista.grafico.titulo.slice(1)}`,
    categorias, series: [{ nome: vista.grafico.nome, cor: CORES_SERIES[0], valores }],
    formato: vista.grafico.formato, maximoFixo: vista.grafico.maximoFixo ?? null,
  });
}

/** O jogo a jogo de um jogador: uma linha por jogo, com as colunas da vista. */
function detalhe(jogador, vista) {
  return h('table', { class: 'tabela tabela-jogos' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'Jogo'),
      h('th', {}, 'Resultado'),
      vista.colunas.map((c) => h('th', { class: 'num', title: c.titulo }, c.rotulo)))),
    h('tbody', {}, jogador.porJogo.map((p) => h('tr', {},
      h('td', {}, `${DATA.format(new Date(p.jogo.dataHora))} · ${p.jogo.emCasa ? 'vs' : 'em'} ${p.jogo.adversarioNome}`),
      h('td', {}, resultadoDoJogo(p.jogo)),
      vista.colunas.map((c) => h('td', { class: 'num' }, formatar(c, p)))))));
}

function linhasJogador(jogador, vista) {
  const aberto = estado.abertos.has(jogador.jogadorId);
  const linha = h('tr', { class: 'linha-jogador' },
    h('td', { class: 'num numero-camisola' }, jogador.numero),
    h('td', {},
      h('button', {
        type: 'button', class: 'abrir-jogador', 'aria-expanded': aberto ? 'true' : 'false',
        title: aberto ? 'Esconder o jogo a jogo' : 'Ver jogo a jogo',
        onclick: () => {
          if (estado.abertos.has(jogador.jogadorId)) estado.abertos.delete(jogador.jogadorId);
          else estado.abertos.add(jogador.jogadorId);
          desenhar();
        },
      }, jogador.nome),
      h('small', { class: 'posicao', title: ROTULO_POSICAO[jogador.posicao] ?? jogador.posicao }, jogador.posicao)),
    vista.colunas.map((c) => h('td', { class: 'num' }, formatar(c, jogador))));
  if (!aberto) return [linha];
  return [linha, h('tr', { class: 'detalhe-jogador' }, h('td', { colspan: vista.colunas.length + 2 },
    graficoDoJogador(jogador, vista),
    h('div', { class: 'tabela-rolagem' }, detalhe(jogador, vista))))];
}

function tabela(r) {
  const vista = estado.vista;
  const jogadores = ordenar(r.jogadores.filter(vista.mostrar), vista, estado.chave, estado.direcao);
  if (!jogadores.length) return h('p', { class: 'vazio', id: 'vista-vazia' }, vista.vazio);
  return h('div', { class: 'tabela-rolagem' },
    h('table', { class: 'tabela tabela-estatisticas', id: 'tabela-estatisticas' },
      h('thead', {}, h('tr', {},
        cabecalhoOrdenavel('numero', '#', 'Número da camisola', true),
        cabecalhoOrdenavel('nome', 'Jogador', 'Nome do jogador', false),
        vista.colunas.map((c) => cabecalhoOrdenavel(c.chave, c.rotulo, c.titulo, true)))),
      h('tbody', {}, jogadores.map((j) => linhasJogador(j, vista))),
      h('tfoot', {}, h('tr', { class: 'linha-equipa' },
        h('td', {}),
        h('td', {}, 'Equipa'),
        vista.colunas.map((c) => h('td', { class: 'num' }, formatar(c, r.equipa)))))));
}

function semJogos(r) {
  if (!r.semJogos.length) return null;
  const comFiltros = estado.local !== 'todos' || estado.parte !== null || estado.ultimos !== null;
  return h('p', { class: 'meta-equipa', id: 'sem-jogos' },
    `${comFiltros ? 'Sem jogos nesta seleção' : 'Ainda sem jogos'}: ${r.semJogos.sort((a, b) => a.numero - b.numero).map(nomeDe).join(', ')}.`);
}

// ---------------------------------------------------------------------
// Filtros e gráficos
// ---------------------------------------------------------------------
function grupoFiltro(rotulo, opcoes) {
  return h('div', { class: 'grupo-filtro', role: 'group', 'aria-label': rotulo },
    h('span', { class: 'grupo-filtro-rotulo' }, rotulo),
    h('div', { class: 'separador-abas' }, opcoes.map(({ texto, ativo, filtro, aoClicar }) => h('button', {
      type: 'button', class: ativo ? 'ativo' : '', 'aria-pressed': ativo ? 'true' : 'false', 'data-filtro': filtro, onclick: aoClicar,
    }, texto))));
}

function filtros() {
  const e = estado;
  return h('div', { class: 'filtros-estatisticas', id: 'filtros-estatisticas' },
    grupoFiltro('Jogos', [
      { texto: 'Todos', ativo: e.local === 'todos', filtro: 'local-todos', aoClicar: () => escolher({ local: 'todos' }) },
      { texto: 'Em casa', ativo: e.local === 'casa', filtro: 'local-casa', aoClicar: () => escolher({ local: 'casa' }) },
      { texto: 'Fora', ativo: e.local === 'fora', filtro: 'local-fora', aoClicar: () => escolher({ local: 'fora' }) },
    ]),
    grupoFiltro('Parte', [
      { texto: 'Jogo todo', ativo: e.parte === null, filtro: 'parte-todas', aoClicar: () => escolher({ parte: null }) },
      { texto: '1.ª parte', ativo: e.parte === 1, filtro: 'parte-1', aoClicar: () => escolher({ parte: 1 }) },
      { texto: '2.ª parte', ativo: e.parte === 2, filtro: 'parte-2', aoClicar: () => escolher({ parte: 2 }) },
    ]),
    grupoFiltro('Período', [
      { texto: 'Toda a época', ativo: e.ultimos === null, filtro: 'ultimos-todos', aoClicar: () => escolher({ ultimos: null }) },
      { texto: `Últimos ${ULTIMOS} jogos`, ativo: e.ultimos === ULTIMOS, filtro: 'ultimos-5', aoClicar: () => escolher({ ultimos: ULTIMOS }) },
    ]));
}

function notaDosFiltros() {
  const partes = [];
  if (estado.local !== 'todos') partes.push(estado.local === 'casa' ? 'jogos em casa' : 'jogos fora');
  if (estado.ultimos) partes.push(`os últimos ${estado.ultimos} jogos`);
  const aParte = estado.parte ? `só a ${estado.parte}.ª parte` : null;
  if (!partes.length && !aParte) return null;
  return h('p', { class: 'meta-equipa', id: 'nota-filtros' },
    `A ver: ${[...partes, aParte].filter(Boolean).join(', ')}.`,
    aParte ? ' Os golos e os resultados (vitórias, empates e derrotas) são os dessa parte.' : null);
}

function cartaoGraficos() {
  const g = estado.grafico;
  return h('div', { class: 'cartao cartao-graficos', id: 'cartao-graficos' },
    h('h2', { class: 'titulo-cartao' }, 'Jogo a jogo'),
    h('div', { class: 'separador-abas', role: 'group', 'aria-label': 'O que ver no gráfico' },
      GRAFICOS_EQUIPA.map((o) => h('button', {
        type: 'button', class: o === g ? 'ativo' : '', 'aria-pressed': o === g ? 'true' : 'false', 'data-grafico': o.codigo,
        onclick: () => { estado.grafico = o; desenhar(); },
      }, o.rotulo))),
    graficoLinhas({
      id: 'grafico-equipa', titulo: g.titulo,
      categorias: estado.resultado.jogosOrdenados.map(categoriaDoJogo),
      series: seriesDoGrafico(g, estado.evolucao).map((s, k) => ({ ...s, cor: CORES_SERIES[k] })),
      formato: g.formato, maximoFixo: g.maximoFixo ?? null,
    }));
}

// ---------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------
function desenhar() {
  const r = estado.resultado;
  const equipa = estado.equipa;
  document.title = `Estatísticas · ${equipa.nome}`;
  const semJogosNoFiltro = r.resumo.jogos === 0;
  substituir(raiz,
    h('p', { class: 'sub sub-equipa' }, escudo(equipa.id, equipa.escudo), h('span', {}, 'Números de ', h('strong', {}, equipa.nome), ' somados nos jogos registados. Clica num jogador para ver jogo a jogo.')),
    filtros(),
    notaDosFiltros(),
    semJogosNoFiltro
      ? h('p', { class: 'vazio', id: 'sem-jogos-no-filtro' }, 'Nenhum jogo com estes filtros.')
      : [resumo(r.resumo), cartaoGraficos(), h('div', { class: 'cartao' }, abas(), tabela(r), semJogos(r))]);
}

function recalcular() {
  const filtrados = filtrarJogos(estado.dados, { local: estado.local, ultimos: estado.ultimos });
  estado.resultado = { ...estatisticasDaEquipa(filtrados), jogosOrdenados: filtrados.jogos };
  estado.evolucao = evolucaoDaEquipa(filtrados);
}

async function buscar(parte) {
  if (!estado.dadosPorParte.has(parte)) {
    estado.dadosPorParte.set(parte, await obter(`/api/equipas/${estado.equipa.id}/estatisticas${parte ? `?parte=${parte}` : ''}`));
  }
  return estado.dadosPorParte.get(parte);
}

/** Muda um filtro: o local e os últimos jogos contam-se aqui; a parte pede os números dessa parte ao servidor. */
async function escolher(parcial) {
  const anterior = { local: estado.local, parte: estado.parte, ultimos: estado.ultimos };
  Object.assign(estado, parcial);
  if (estado.parte !== anterior.parte) {
    raiz.classList.add('a-carregar');   // mantém o que está no ecrã, mais apagado, enquanto os números chegam
    try {
      estado.dados = await buscar(estado.parte);
    } catch (erro) {
      Object.assign(estado, anterior);
      avisar(`Não foi possível carregar a parte: ${erro.message}`, { erro: true });
      return;
    } finally {
      raiz.classList.remove('a-carregar');
    }
  }
  recalcular();
  desenhar();
}

function mostrarVazio(titulo, texto, ligacao) {
  substituir(raiz, h('section', { class: 'cartao' },
    h('h2', {}, titulo),
    h('p', { class: 'vazio' }, texto),
    ligacao && h('a', { class: 'botao-link primario', href: ligacao.href }, ligacao.texto)));
}

async function carregar() {
  let equipas;
  try {
    equipas = await obter('/api/equipas');
  } catch (erro) {
    substituir(raiz, h('p', { class: 'aviso-inline erro', role: 'alert' }, `Não foi possível carregar as equipas: ${erro.message}`));
    return;
  }
  const propria = equipas.find((e) => e.propria);
  if (!propria) {
    mostrarVazio('Ainda não tens equipa', 'Cria a tua equipa e junta os jogadores ao plantel. As estatísticas aparecem depois dos primeiros jogos.',
      { href: 'equipas.html', texto: 'Criar a minha equipa' });
    return;
  }
  estado.equipa = propria;

  try {
    estado.dados = await buscar(null);
  } catch (erro) {
    substituir(raiz, h('p', { class: 'aviso-inline erro', role: 'alert' }, `Não foi possível carregar as estatísticas: ${erro.message}`));
    return;
  }
  if (!estado.dados.jogos?.length) {
    mostrarVazio(propria.nome, 'Ainda não há jogos registados. Assim que registares um jogo desta equipa, os números dos jogadores aparecem aqui.',
      { href: './', texto: 'Ver os meus jogos' });
    return;
  }
  recalcular();
  desenhar();
}

await carregar();
