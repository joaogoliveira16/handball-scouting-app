// Estatísticas dos jogadores da equipa da conta, somadas em todos os jogos registados. Clicar num jogador mostra jogo a jogo.
// As contas estão em estatisticas-jogadores.js (testado à parte); aqui só se desenha.
import { h, substituir } from './dom.js';
import { obter, ROTULO_POSICAO } from './api.js';
import { exigirConta } from './conta.js';
import { escudo } from './escudo.js';
import { estatisticasDaEquipa, VISTAS, formatar, ordenar } from './estatisticas-jogadores.js';

await exigirConta();

const raiz = document.getElementById('estatisticas');
const DATA = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });

const estado = {
  equipa: null,       // a equipa da conta
  resultado: null,    // o que estatisticasDaEquipa devolve
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
  return [linha, h('tr', { class: 'detalhe-jogador' }, h('td', { colspan: vista.colunas.length + 2 }, h('div', { class: 'tabela-rolagem' }, detalhe(jogador, vista))))];
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
  return h('p', { class: 'meta-equipa', id: 'sem-jogos' },
    `Ainda sem jogos: ${r.semJogos.sort((a, b) => a.numero - b.numero).map(nomeDe).join(', ')}.`);
}

// ---------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------
function desenhar() {
  const r = estado.resultado;
  const equipa = estado.equipa;
  document.title = `Estatísticas · ${equipa.nome}`;
  substituir(raiz,
    h('p', { class: 'sub sub-equipa' }, escudo(equipa.id, equipa.escudo), h('span', {}, 'Números de ', h('strong', {}, equipa.nome), ' somados em todos os jogos registados. Clica num jogador para ver jogo a jogo.')),
    resumo(r.resumo),
    h('div', { class: 'cartao' }, abas(), tabela(r), semJogos(r)));
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

  let dados;
  try {
    dados = await obter(`/api/equipas/${propria.id}/estatisticas`);
  } catch (erro) {
    substituir(raiz, h('p', { class: 'aviso-inline erro', role: 'alert' }, `Não foi possível carregar as estatísticas: ${erro.message}`));
    return;
  }
  estado.resultado = estatisticasDaEquipa(dados);

  if (!estado.resultado.resumo.jogos) {
    mostrarVazio(propria.nome, 'Ainda não há jogos registados. Assim que registares um jogo desta equipa, os números dos jogadores aparecem aqui.',
      { href: './', texto: 'Ver os meus jogos' });
    return;
  }
  desenhar();
}

await carregar();
