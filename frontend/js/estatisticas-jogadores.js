// Estatísticas dos jogadores da equipa da conta: soma os números de cada jogador em todos os jogos registados.
// Recebe o que a API devolve em GET /api/equipas/{id}/estatisticas (o plantel, os jogos e uma linha por jogador e jogo)
// e não mexe no DOM, para se poder testar (tests/unidade/estatisticas-jogadores.test.mjs). A página é estatisticas.html.
import { eficaciaDe } from './analise.js';

const CONTADORES = [
  'remates', 'golos', 'defendidos', 'fora', 'poste', 'bloqueados',
  'seteMetros', 'golosSeteMetros', 'contraAtaques', 'golosContraAtaque',
  'perdasBola', 'faltasOfensivas', 'doisMinutos', 'vermelhos',
  'defesas', 'golosSofridos', 'seteMetrosSofridos', 'defesasSeteMetros',
];

const dividir = (a, b) => (b ? a / b : null);

/** Todos os contadores a zero (mais os jogos). */
export const zeros = () => ({ jogos: 0, ...Object.fromEntries(CONTADORES.map((c) => [c, 0])) });

/** Soma linhas de um jogador (uma por jogo em que entrou): "jogos" é quantas linhas há. */
export function somar(linhas) {
  const t = zeros();
  for (const linha of linhas) {
    t.jogos += 1;
    for (const c of CONTADORES) t[c] += Number(linha[c] ?? 0);
  }
  return t;
}

/** O que se calcula a partir dos totais: eficácia, golos por jogo, remates à baliza e percentagem de defesa. */
export function derivados(t) {
  const rematesBaliza = t.defesas + t.golosSofridos;   // fora, poste e bloqueados não chegam ao guarda-redes
  return {
    eficacia: eficaciaDe(t.golos, t.remates),
    golosPorJogo: dividir(t.golos, t.jogos),
    rematesBaliza,
    percentagemDefesa: rematesBaliza ? eficaciaDe(t.defesas, rematesBaliza) : null,
    defesasPorJogo: dividir(t.defesas, t.jogos),
  };
}

const completar = (totais) => ({ ...totais, ...derivados(totais) });

/** O resultado de cada jogo visto da equipa: 'V', 'E' ou 'D'. */
export const resultadoDe = (jogo) => (jogo.golos > jogo.golosAdversario ? 'V' : jogo.golos < jogo.golosAdversario ? 'D' : 'E');

/**
 * Fica só com os jogos que interessam (e as linhas deles) antes de somar. A lista de jogos vem do mais antigo para o
 * mais recente. `local`: 'todos', 'casa' ou 'fora'; `ultimos`: os N jogos mais recentes (depois de escolher o local).
 */
export function filtrarJogos(dados, { local = 'todos', ultimos = null } = {}) {
  let jogos = [...(dados.jogos ?? [])];
  if (local === 'casa') jogos = jogos.filter((j) => j.emCasa);
  else if (local === 'fora') jogos = jogos.filter((j) => !j.emCasa);
  if (ultimos) jogos = jogos.slice(-ultimos);
  const ids = new Set(jogos.map((j) => j.jogoId));
  return { ...dados, jogos, linhas: (dados.linhas ?? []).filter((l) => ids.has(l.jogoId)) };
}

/**
 * @param {{plantel: object[], jogos: object[], linhas: object[]}} dados
 * @returns {{resumo: object, equipa: object, jogadores: object[], semJogos: object[]}}
 *   jogadores: os que já entraram em algum jogo, com os totais, os derivados e o "porJogo" (um item por jogo, do mais
 *   antigo para o mais recente); semJogos: os do plantel que ainda não jogaram.
 */
export function estatisticasDaEquipa(dados) {
  const jogos = [...(dados.jogos ?? [])];
  const ordemJogo = new Map(jogos.map((j, i) => [j.jogoId, i]));
  const jogoPorId = new Map(jogos.map((j) => [j.jogoId, j]));

  const linhasPorJogador = new Map();
  for (const linha of dados.linhas ?? []) {
    if (!jogoPorId.has(linha.jogoId)) continue;   // um jogo que a lista de jogos não traz não entra nas contas
    if (!linhasPorJogador.has(linha.jogadorId)) linhasPorJogador.set(linha.jogadorId, []);
    linhasPorJogador.get(linha.jogadorId).push(linha);
  }

  const todos = (dados.plantel ?? []).map((j) => {
    const linhas = (linhasPorJogador.get(j.id) ?? []).sort((a, b) => ordemJogo.get(a.jogoId) - ordemJogo.get(b.jogoId));
    return {
      jogadorId: j.id, numero: j.numero, nome: j.nome, posicao: j.posicao,
      ...completar(somar(linhas)),
      porJogo: linhas.map((l) => ({ jogo: jogoPorId.get(l.jogoId), ...completar(somar([l])) })),
    };
  });

  // A equipa: a soma de todos os jogadores, com os jogos da equipa (não a soma dos jogos de cada um)
  const equipa = zeros();
  for (const j of todos) for (const c of CONTADORES) equipa[c] += j[c];
  equipa.jogos = jogos.length;

  const resultados = jogos.map(resultadoDe);
  return {
    resumo: {
      jogos: jogos.length,
      vitorias: resultados.filter((r) => r === 'V').length,
      empates: resultados.filter((r) => r === 'E').length,
      derrotas: resultados.filter((r) => r === 'D').length,
      golosMarcados: jogos.reduce((s, j) => s + Number(j.golos), 0),
      golosSofridos: jogos.reduce((s, j) => s + Number(j.golosAdversario), 0),
    },
    equipa: completar(equipa),
    jogadores: todos.filter((j) => j.jogos > 0),
    semJogos: todos.filter((j) => j.jogos === 0),
  };
}

// ---------------------------------------------------------------------
// As vistas da página (o que se mostra em cada separador) e a ordenação
// ---------------------------------------------------------------------
const par = (a, b) => `${a}/${b}`;

/**
 * Cada coluna: chave (também a ordem inicial), rótulo, título (explica a coluna), valor (o que se ordena; null = sem dados)
 * e texto (o que se vê; por omissão o próprio valor, com "formato" para percentagem ou decimal).
 */
export const VISTAS = [
  {
    codigo: 'ataque', rotulo: 'Ataque', ordemInicial: 'golos',
    grafico: { nome: 'Golos', titulo: 'Golos em cada jogo', valor: (t) => t.golos, formato: 'inteiro' },
    vazio: 'Ainda não há remates registados.',
    mostrar: (j) => j.remates > 0 || (j.jogos > 0 && j.posicao !== 'GR'),
    colunas: [
      { chave: 'jogos', rotulo: 'J', titulo: 'Jogos em que entrou', valor: (t) => t.jogos },
      { chave: 'golos', rotulo: 'Golos', titulo: 'Golos marcados', valor: (t) => t.golos },
      { chave: 'remates', rotulo: 'Remates', titulo: 'Remates feitos', valor: (t) => t.remates },
      { chave: 'eficacia', rotulo: 'Eficácia', titulo: 'Golos a dividir pelos remates', valor: (t) => t.eficacia, formato: 'percentagem' },
      { chave: 'golosPorJogo', rotulo: 'Golos/jogo', titulo: 'Golos por jogo em que entrou', valor: (t) => t.golosPorJogo, formato: 'decimal' },
      { chave: 'seteMetros', rotulo: '7 m', titulo: 'Golos / lançamentos de 7 metros', valor: (t) => t.golosSeteMetros, texto: (t) => (t.seteMetros ? par(t.golosSeteMetros, t.seteMetros) : '–') },
      { chave: 'contraAtaques', rotulo: 'Contra-ataque', titulo: 'Golos / remates em contra-ataque', valor: (t) => t.golosContraAtaque, texto: (t) => (t.contraAtaques ? par(t.golosContraAtaque, t.contraAtaques) : '–') },
    ],
  },
  {
    codigo: 'guardaRedes', rotulo: 'Guarda-redes', ordemInicial: 'defesas',
    grafico: { nome: '% de defesa', titulo: 'Percentagem de defesa em cada jogo', valor: (t) => t.percentagemDefesa, formato: 'percentagem', maximoFixo: 100 },
    vazio: 'Ainda não há guarda-redes com jogos registados.',
    mostrar: (j) => j.rematesBaliza > 0 || (j.jogos > 0 && j.posicao === 'GR'),
    colunas: [
      { chave: 'jogos', rotulo: 'J', titulo: 'Jogos em que entrou', valor: (t) => t.jogos },
      { chave: 'defesas', rotulo: 'Defesas', titulo: 'Remates defendidos', valor: (t) => t.defesas },
      { chave: 'golosSofridos', rotulo: 'Golos sofridos', titulo: 'Golos que sofreu', valor: (t) => t.golosSofridos },
      { chave: 'rematesBaliza', rotulo: 'À baliza', titulo: 'Remates à baliza: defesas mais golos sofridos (fora, poste e bloqueados não contam)', valor: (t) => t.rematesBaliza },
      { chave: 'percentagemDefesa', rotulo: '% defesa', titulo: 'Defesas a dividir pelos remates à baliza', valor: (t) => t.percentagemDefesa, formato: 'percentagem' },
      { chave: 'defesasPorJogo', rotulo: 'Defesas/jogo', titulo: 'Defesas por jogo em que entrou', valor: (t) => t.defesasPorJogo, formato: 'decimal' },
      { chave: 'defesasSeteMetros', rotulo: '7 m', titulo: 'Defendidos / lançamentos de 7 metros', valor: (t) => t.defesasSeteMetros, texto: (t) => (t.seteMetrosSofridos ? par(t.defesasSeteMetros, t.seteMetrosSofridos) : '–') },
    ],
  },
  {
    codigo: 'disciplina', rotulo: 'Bola e disciplina', ordemInicial: 'doisMinutos',
    grafico: { nome: 'Perdas de bola', titulo: 'Perdas de bola em cada jogo', valor: (t) => t.perdasBola, formato: 'inteiro' },
    vazio: 'Ainda não há jogos registados.',
    mostrar: (j) => j.jogos > 0,
    colunas: [
      { chave: 'jogos', rotulo: 'J', titulo: 'Jogos em que entrou', valor: (t) => t.jogos },
      { chave: 'perdasBola', rotulo: 'Perdas de bola', titulo: 'Perdas de bola', valor: (t) => t.perdasBola },
      { chave: 'faltasOfensivas', rotulo: 'Faltas ofensivas', titulo: 'Faltas ofensivas', valor: (t) => t.faltasOfensivas },
      { chave: 'doisMinutos', rotulo: '2 min', titulo: 'Exclusões de 2 minutos', valor: (t) => t.doisMinutos },
      { chave: 'vermelhos', rotulo: 'Vermelhos', titulo: 'Cartões vermelhos diretos', valor: (t) => t.vermelhos },
    ],
  },
];

/** O texto de uma coluna para uma linha de totais (um jogador, um jogo ou a equipa). */
export function formatar(coluna, totais) {
  if (coluna.texto) return coluna.texto(totais);
  const valor = coluna.valor(totais);
  if (valor == null) return '–';
  if (coluna.formato === 'percentagem') return `${Math.round(valor)}%`;
  if (coluna.formato === 'decimal') return (Math.round(valor * 10) / 10).toFixed(1).replace('.', ',');
  return String(valor);
}

/**
 * Ordena os jogadores por uma coluna da vista ('numero' e 'nome' também servem). Quem não tem dados (null) fica no fim,
 * e os empates desfazem-se pelo número da camisola.
 */
export function ordenar(jogadores, vista, chave, direcao = 'desc') {
  const sinal = direcao === 'asc' ? 1 : -1;
  const coluna = vista.colunas.find((c) => c.chave === chave);
  const valorDe = (j) => (chave === 'numero' ? j.numero : chave === 'nome' ? j.nome : coluna?.valor(j) ?? null);
  return [...jogadores].sort((a, b) => {
    const va = valorDe(a);
    const vb = valorDe(b);
    if (va == null && vb == null) return a.numero - b.numero;
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === 'string' ? va.localeCompare(vb, 'pt-PT') : va - vb;
    return cmp !== 0 ? sinal * cmp : a.numero - b.numero;
  });
}

// ---------------------------------------------------------------------
// Evolução jogo a jogo (os gráficos)
// ---------------------------------------------------------------------
const doisDigitos = (n) => String(n).padStart(2, '0');
const dataCurta = (dataHora) => { const d = new Date(dataHora); return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}`; };
const dataLonga = (dataHora) => { const d = new Date(dataHora); return `${dataCurta(dataHora)}/${d.getFullYear()}`; };
const abreviar = (nome, max = 9) => (nome.length > max ? `${nome.slice(0, max - 1).trimEnd()}…` : nome);

/** O rótulo de cada jogo nos gráficos: a data e o adversário (curto, no eixo) e tudo na dica («05/09/2026 · vs Leões · V 25–20»). */
export function categoriaDoJogo(jogo) {
  return {
    curto: dataCurta(jogo.dataHora),
    curto2: abreviar(jogo.adversarioNome),
    longo: `${dataLonga(jogo.dataHora)} · ${jogo.emCasa ? 'vs' : 'em'} ${jogo.adversarioNome} · ${resultadoDe(jogo)} ${jogo.golos}–${jogo.golosAdversario}`,
  };
}

/**
 * Os números da equipa em cada jogo (a soma dos jogadores), do mais antigo para o mais recente, para os gráficos.
 * @returns {object[]} { jogo, golos, golosAdversario, remates, eficacia, percentagemDefesa, perdasBola, ... }
 */
export function evolucaoDaEquipa(dados) {
  const linhasPorJogo = new Map();
  for (const linha of dados.linhas ?? []) {
    if (!linhasPorJogo.has(linha.jogoId)) linhasPorJogo.set(linha.jogoId, []);
    linhasPorJogo.get(linha.jogoId).push(linha);
  }
  return (dados.jogos ?? []).map((jogo) => {
    const t = somar(linhasPorJogo.get(jogo.jogoId) ?? []);
    return {
      jogo,
      ...t,
      ...derivados(t),
      golos: Number(jogo.golos),   // os golos do jogo (iguais à soma dos jogadores: todo o remate tem jogador)
      golosAdversario: Number(jogo.golosAdversario),
    };
  });
}

/** Os gráficos da equipa: cada um tem as suas séries (a chave é um campo de evolucaoDaEquipa) e o formato dos valores. */
export const GRAFICOS_EQUIPA = [
  { codigo: 'golos', rotulo: 'Golos', titulo: 'Golos marcados e sofridos em cada jogo', formato: 'inteiro',
    series: [{ chave: 'golos', nome: 'Marcados' }, { chave: 'golosAdversario', nome: 'Sofridos' }] },
  { codigo: 'eficacia', rotulo: 'Eficácia', titulo: 'Eficácia de remate em cada jogo (golos a dividir pelos remates)', formato: 'percentagem', maximoFixo: 100,
    series: [{ chave: 'eficacia', nome: 'Eficácia' }] },
  { codigo: 'defesa', rotulo: 'Guarda-redes', titulo: 'Defesa dos guarda-redes em cada jogo (defesas a dividir pelos remates à baliza)', formato: 'percentagem', maximoFixo: 100,
    series: [{ chave: 'percentagemDefesa', nome: '% de defesa' }] },
  { codigo: 'perdas', rotulo: 'Perdas de bola', titulo: 'Perdas de bola em cada jogo', formato: 'inteiro',
    series: [{ chave: 'perdasBola', nome: 'Perdas de bola' }] },
];

/** As séries de um gráfico da equipa prontas para desenhar: [{ nome, valores }] (sem valor = null). */
export function seriesDoGrafico(grafico, evolucao) {
  return grafico.series.map((s) => ({ nome: s.nome, valores: evolucao.map((e) => e[s.chave] ?? null) }));
}

/**
 * A evolução de um jogador na vista escolhida, jogo a jogo: o que se desenha na vista (ver `grafico` em VISTAS).
 * @returns {{categorias: object[], valores: (number|null)[]}}
 */
export function serieDoJogador(jogador, vista) {
  return {
    categorias: jogador.porJogo.map((p) => categoriaDoJogo(p.jogo)),
    valores: jogador.porJogo.map((p) => vista.grafico.valor(p) ?? null),
  };
}
