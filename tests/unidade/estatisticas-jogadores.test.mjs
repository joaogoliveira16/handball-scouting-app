// Testes das estatísticas dos jogadores da equipa (frontend/js/estatisticas-jogadores.js): somar jogo a jogo,
// os números que se calculam a partir dos totais, as vistas da página e a ordenação.
//   node --no-warnings --test unidade/
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estatisticasDaEquipa, somar, derivados, formatar, ordenar, resultadoDe, zeros, VISTAS,
  GRAFICOS_EQUIPA, categoriaDoJogo, evolucaoDaEquipa, filtrarJogos, serieDoJogador, seriesDoGrafico,
} from '../../frontend/js/estatisticas-jogadores.js';

const vista = (codigo) => VISTAS.find((v) => v.codigo === codigo);
const coluna = (codigo, chave) => vista(codigo).colunas.find((c) => c.chave === chave);

/** Uma linha jogador/jogo da API: tudo a zero menos o que se diz. */
const linha = (jogadorId, jogoId, extra = {}) => ({ ...Object.fromEntries(Object.keys(zeros()).filter((k) => k !== 'jogos').map((k) => [k, 0])), jogadorId, jogoId, ...extra });

const dados = () => ({
  equipaId: 1,
  plantel: [
    { id: 1, numero: 1, nome: 'Rui Mesquita', posicao: 'GR', eventos: 9 },
    { id: 7, numero: 7, nome: 'André Fonseca', posicao: 'LE', eventos: 9 },
    { id: 9, numero: 9, nome: 'Miguel Sousa', posicao: 'PD', eventos: 4 },
    { id: 11, numero: 11, nome: 'Zé Banco', posicao: 'CE', eventos: 0 },
  ],
  jogos: [
    { jogoId: 20, dataHora: '2026-10-01T18:00:00Z', adversarioId: 2, adversarioNome: 'Leões', emCasa: true, golos: 25, golosAdversario: 20 },
    { jogoId: 21, dataHora: '2026-10-08T18:00:00Z', adversarioId: 3, adversarioNome: 'Tigres', emCasa: false, golos: 18, golosAdversario: 18 },
    { jogoId: 22, dataHora: '2026-10-15T18:00:00Z', adversarioId: 2, adversarioNome: 'Leões', emCasa: false, golos: 15, golosAdversario: 22 },
  ],
  linhas: [
    // Os jogos chegam fora de ordem para provar que se ordenam pela lista de jogos
    linha(7, 22, { remates: 4, golos: 1, defendidos: 2, fora: 1, doisMinutos: 1 }),
    linha(7, 20, { remates: 6, golos: 4, defendidos: 1, poste: 1, seteMetros: 2, golosSeteMetros: 2, perdasBola: 2 }),
    linha(7, 21, { remates: 5, golos: 3, fora: 2, contraAtaques: 2, golosContraAtaque: 1, faltasOfensivas: 1 }),
    linha(9, 20, { remates: 3, golos: 3 }),
    linha(9, 21, {}),   // entrou e não rematou
    linha(1, 20, { defesas: 7, golosSofridos: 13, seteMetrosSofridos: 2, defesasSeteMetros: 1 }),
    linha(1, 22, { defesas: 5, golosSofridos: 17 }),
    linha(7, 99, { remates: 50, golos: 50 }),   // um jogo que não está na lista de jogos: ignorado
  ],
});

test('soma as linhas de um jogador e conta os jogos em que entrou', () => {
  const t = somar([linha(7, 20, { remates: 6, golos: 4 }), linha(7, 21, { remates: 5, golos: 3, vermelhos: 1 })]);
  assert.equal(t.jogos, 2);
  assert.equal(t.remates, 11);
  assert.equal(t.golos, 7);
  assert.equal(t.vermelhos, 1);
  assert.deepEqual(somar([]), zeros());
  assert.equal(zeros().jogos, 0);
});

test('a eficácia, os golos por jogo e a percentagem de defesa saem dos totais', () => {
  const d = derivados({ ...zeros(), jogos: 3, remates: 15, golos: 8, defesas: 12, golosSofridos: 30 });
  assert.equal(d.eficacia, 53.3);
  assert.equal(Math.round(d.golosPorJogo * 100) / 100, 2.67);
  assert.equal(d.rematesBaliza, 42);
  assert.equal(d.percentagemDefesa, 28.6);
  const nada = derivados(zeros());
  assert.deepEqual([nada.eficacia, nada.golosPorJogo, nada.percentagemDefesa, nada.defesasPorJogo], [null, null, null, null]);
});

test('cada jogador fica com os totais, os derivados e os jogos por ordem', () => {
  const { jogadores } = estatisticasDaEquipa(dados());
  const sete = jogadores.find((j) => j.numero === 7);
  assert.deepEqual([sete.jogos, sete.remates, sete.golos, sete.eficacia], [3, 15, 8, 53.3]);
  assert.deepEqual([sete.seteMetros, sete.golosSeteMetros, sete.doisMinutos, sete.perdasBola, sete.faltasOfensivas], [2, 2, 1, 2, 1]);
  assert.deepEqual(sete.porJogo.map((p) => p.jogo.jogoId), [20, 21, 22], 'do mais antigo para o mais recente');
  assert.deepEqual(sete.porJogo.map((p) => p.golos), [4, 3, 1]);
  assert.equal(sete.porJogo[0].eficacia, 66.7);
  assert.equal(sete.porJogo[0].jogos, 1);
  assert.equal(sete.remates, 15, 'o jogo que não está na lista de jogos não conta');
});

test('quem ainda não jogou fica à parte', () => {
  const r = estatisticasDaEquipa(dados());
  assert.deepEqual(r.jogadores.map((j) => j.numero), [1, 7, 9]);
  assert.deepEqual(r.semJogos.map((j) => j.numero), [11]);
});

test('o guarda-redes tem as defesas e a percentagem', () => {
  const gr = estatisticasDaEquipa(dados()).jogadores.find((j) => j.posicao === 'GR');
  assert.deepEqual([gr.jogos, gr.defesas, gr.golosSofridos, gr.rematesBaliza, gr.percentagemDefesa], [2, 12, 30, 42, 28.6]);
  assert.deepEqual([gr.seteMetrosSofridos, gr.defesasSeteMetros], [2, 1]);
});

test('o resumo da equipa: vitórias, empates, derrotas e golos', () => {
  const { resumo, equipa } = estatisticasDaEquipa(dados());
  assert.deepEqual(resumo, { jogos: 3, vitorias: 1, empates: 1, derrotas: 1, golosMarcados: 58, golosSofridos: 60 });
  assert.deepEqual(['V', 'E', 'D'], dados().jogos.map(resultadoDe));
  assert.equal(equipa.jogos, 3, 'os jogos da equipa, não a soma dos de cada jogador');
  assert.equal(equipa.golos, 8 + 3, 'a soma dos jogadores');
});

test('sem jogos nem linhas não há jogadores e nada rebenta', () => {
  const r = estatisticasDaEquipa({ plantel: [{ id: 1, numero: 4, nome: 'Só', posicao: 'CE' }], jogos: [], linhas: [] });
  assert.deepEqual(r.jogadores, []);
  assert.equal(r.semJogos.length, 1);
  assert.equal(r.resumo.jogos, 0);
  assert.equal(r.equipa.eficacia, null);
});

test('cada vista mostra só quem tem a ver com ela', () => {
  const { jogadores } = estatisticasDaEquipa(dados());
  const numeros = (codigo) => jogadores.filter(vista(codigo).mostrar).map((j) => j.numero);
  assert.deepEqual(numeros('ataque'), [7, 9], 'o guarda-redes não tem remates: fica de fora; o #9 jogou e rematou');
  assert.deepEqual(numeros('guardaRedes'), [1]);
  assert.deepEqual(numeros('disciplina'), [1, 7, 9], 'todos os que jogaram');
  // Um jogador de campo que jogou e nunca rematou continua no ataque (com zeros); um guarda-redes que marcou um golo também
  const so = estatisticasDaEquipa({ plantel: [{ id: 5, numero: 5, nome: 'Fechado', posicao: 'PV' }, { id: 6, numero: 6, nome: 'GR Golo', posicao: 'GR' }],
    jogos: dados().jogos.slice(0, 1), linhas: [linha(5, 20, {}), linha(6, 20, { remates: 1, golos: 1 })] });
  assert.deepEqual(so.jogadores.filter(vista('ataque').mostrar).map((j) => j.numero), [5, 6]);
});

test('os números mostram-se com o formato de cada coluna', () => {
  const sete = estatisticasDaEquipa(dados()).jogadores.find((j) => j.numero === 7);
  assert.equal(formatar(coluna('ataque', 'eficacia'), sete), '53%');
  assert.equal(formatar(coluna('ataque', 'golosPorJogo'), sete), '2,7');
  assert.equal(formatar(coluna('ataque', 'seteMetros'), sete), '2/2');
  assert.equal(formatar(coluna('ataque', 'contraAtaques'), sete), '1/2');
  assert.equal(formatar(coluna('ataque', 'golos'), sete), '8');
  const nove = estatisticasDaEquipa(dados()).jogadores.find((j) => j.numero === 9);
  assert.equal(formatar(coluna('ataque', 'seteMetros'), nove), '–', 'sem lançamentos');
  const zero = estatisticasDaEquipa({ plantel: [{ id: 5, numero: 5, nome: 'X', posicao: 'PV' }], jogos: dados().jogos.slice(0, 1), linhas: [linha(5, 20)] }).jogadores[0];
  assert.equal(formatar(coluna('ataque', 'eficacia'), zero), '–', 'sem remates não há eficácia');
  const gr = estatisticasDaEquipa(dados()).jogadores.find((j) => j.numero === 1);
  assert.equal(formatar(coluna('guardaRedes', 'percentagemDefesa'), gr), '29%');
  assert.equal(formatar(coluna('guardaRedes', 'defesasSeteMetros'), gr), '1/2');
  assert.equal(formatar(coluna('guardaRedes', 'defesasPorJogo'), gr), '6,0');
});

test('ordenar: pela coluna, com os vazios no fim e os empates pelo número', () => {
  const { jogadores } = estatisticasDaEquipa(dados());
  const ataque = vista('ataque');
  const visiveis = jogadores.filter(ataque.mostrar);
  assert.deepEqual(ordenar(visiveis, ataque, 'golos').map((j) => j.numero), [7, 9]);
  assert.deepEqual(ordenar(visiveis, ataque, 'golos', 'asc').map((j) => j.numero), [9, 7]);
  assert.deepEqual(ordenar(visiveis, ataque, 'eficacia').map((j) => j.numero), [9, 7], 'o #9 tem 100%');
  assert.deepEqual(ordenar(visiveis, ataque, 'numero', 'asc').map((j) => j.numero), [7, 9]);
  assert.deepEqual(ordenar(visiveis, ataque, 'nome', 'asc').map((j) => j.nome), ['André Fonseca', 'Miguel Sousa']);
  // sem dados (eficácia null) vai para o fim, nos dois sentidos
  const comVazio = [...visiveis, { numero: 3, nome: 'Z', remates: 0, golos: 0, jogos: 1, eficacia: null, posicao: 'PV' }];
  assert.equal(ordenar(comVazio, ataque, 'eficacia').at(-1).numero, 3);
  assert.equal(ordenar(comVazio, ataque, 'eficacia', 'asc').at(-1).numero, 3);
  // empate: pelo número da camisola
  const iguais = [{ numero: 9, golos: 2 }, { numero: 4, golos: 2 }, { numero: 6, golos: 3 }];
  assert.deepEqual(ordenar(iguais, ataque, 'golos').map((j) => j.numero), [6, 4, 9]);
  // não mexe na lista original
  const copia = [...visiveis];
  ordenar(visiveis, ataque, 'golos', 'asc');
  assert.deepEqual(visiveis, copia);
});

test('a ordem inicial de cada vista é uma das suas colunas', () => {
  for (const v of VISTAS) assert.ok(v.colunas.some((c) => c.chave === v.ordemInicial), v.codigo);
  assert.equal(new Set(VISTAS.map((v) => v.codigo)).size, VISTAS.length);
});

// ---------------------------------------------------------------------
// Filtros e evolução jogo a jogo
// ---------------------------------------------------------------------
test('filtrar os jogos: em casa, fora e os últimos N, e as linhas acompanham', () => {
  const d = dados();
  const ids = (f) => filtrarJogos(d, f).jogos.map((j) => j.jogoId);
  assert.deepEqual(ids({}), [20, 21, 22]);
  assert.deepEqual(ids({ local: 'casa' }), [20]);
  assert.deepEqual(ids({ local: 'fora' }), [21, 22]);
  assert.deepEqual(ids({ ultimos: 2 }), [21, 22], 'os mais recentes');
  assert.deepEqual(ids({ local: 'fora', ultimos: 1 }), [22], 'o último jogo fora, não o último jogo');
  assert.deepEqual(ids({ ultimos: 10 }), [20, 21, 22], 'pedir mais do que há não estraga');
  assert.deepEqual(ids({ local: 'casa', ultimos: 5 }), [20]);
  const fora = filtrarJogos(d, { local: 'fora' });
  assert.ok(fora.linhas.every((l) => [21, 22].includes(l.jogoId)), 'as linhas do jogo em casa saem');
  assert.equal(d.jogos.length, 3, 'não mexe nos dados originais');

  // as contas seguem o filtro: o #7 só jogou o jogo 21 e o 22 fora
  const r = estatisticasDaEquipa(fora);
  assert.deepEqual([r.resumo.jogos, r.resumo.vitorias, r.resumo.empates, r.resumo.derrotas], [2, 0, 1, 1]);
  assert.deepEqual([r.resumo.golosMarcados, r.resumo.golosSofridos], [33, 40]);
  const sete = r.jogadores.find((j) => j.numero === 7);
  assert.deepEqual([sete.jogos, sete.remates, sete.golos], [2, 9, 4]);
  assert.deepEqual(r.jogadores.map((j) => j.numero), [1, 7, 9], 'o #9 só tem o jogo 21 (entrou e não rematou)');
  // sem jogos no filtro: tudo a zero e os jogadores passam para «ainda sem jogos»
  const nenhum = estatisticasDaEquipa(filtrarJogos({ ...d, jogos: d.jogos.filter((j) => !j.emCasa) }, { local: 'casa' }));
  assert.equal(nenhum.resumo.jogos, 0);
  assert.equal(nenhum.jogadores.length, 0);
});

test('a evolução da equipa: uma linha por jogo, do mais antigo ao mais recente', () => {
  const e = evolucaoDaEquipa(dados());
  assert.deepEqual(e.map((x) => x.jogo.jogoId), [20, 21, 22]);
  assert.deepEqual(e.map((x) => [x.golos, x.golosAdversario]), [[25, 20], [18, 18], [15, 22]], 'os golos são os do jogo');
  assert.deepEqual(e.map((x) => x.remates), [9, 5, 4], 'o resto é a soma dos jogadores desse jogo');
  assert.deepEqual(e.map((x) => x.eficacia), [77.8, 60, 25].map((v) => v), 'golos dos jogadores a dividir pelos remates');
  assert.deepEqual(e.map((x) => x.percentagemDefesa), [35, null, 22.7], 'sem remates à baliza não há percentagem (e não 0)');
  assert.deepEqual(e.map((x) => x.perdasBola), [2, 0, 0]);
  assert.deepEqual(evolucaoDaEquipa({ jogos: [], linhas: [] }), []);
  // um jogo sem linhas (ninguém convocado) aparece com zeros e sem percentagens
  const vazio = evolucaoDaEquipa({ jogos: dados().jogos.slice(0, 1), linhas: [] })[0];
  assert.deepEqual([vazio.golos, vazio.remates, vazio.eficacia, vazio.percentagemDefesa], [25, 0, null, null]);
});

test('os gráficos da equipa dão as séries certas, sempre com um valor por jogo', () => {
  const e = evolucaoDaEquipa(dados());
  const por = (codigo) => seriesDoGrafico(GRAFICOS_EQUIPA.find((g) => g.codigo === codigo), e);
  assert.deepEqual(por('golos'), [{ nome: 'Marcados', valores: [25, 18, 15] }, { nome: 'Sofridos', valores: [20, 18, 22] }]);
  assert.deepEqual(por('eficacia'), [{ nome: 'Eficácia', valores: [77.8, 60, 25] }]);
  assert.deepEqual(por('defesa')[0].valores, [35, null, 22.7]);
  assert.deepEqual(por('perdas')[0].valores, [2, 0, 0]);
  for (const g of GRAFICOS_EQUIPA) {
    assert.ok(g.titulo && g.rotulo && ['inteiro', 'percentagem'].includes(g.formato), g.codigo);
    assert.ok(g.series.length >= 1 && g.series.length <= 2, 'uma ou duas séries');
    if (g.formato === 'percentagem') assert.equal(g.maximoFixo, 100, 'as percentagens têm o eixo em 100');
    for (const s of seriesDoGrafico(g, e)) assert.equal(s.valores.length, 3, `${g.codigo}: um valor por jogo`);
  }
  assert.equal(new Set(GRAFICOS_EQUIPA.map((g) => g.codigo)).size, GRAFICOS_EQUIPA.length);
});

test('o rótulo de cada jogo diz a data, o adversário e o resultado', () => {
  const c = categoriaDoJogo({ jogoId: 1, dataHora: '2026-10-01T12:00:00Z', adversarioNome: 'Leões do Sul', emCasa: true, golos: 25, golosAdversario: 20 });
  assert.equal(c.curto, '01/10');
  assert.equal(c.curto2, 'Leões do…', 'o nome comprido encurta-se no eixo');
  assert.equal(c.longo, '01/10/2026 · vs Leões do Sul · V 25–20');
  const fora = categoriaDoJogo({ jogoId: 2, dataHora: '2026-11-15T12:00:00Z', adversarioNome: 'Tigres', emCasa: false, golos: 18, golosAdversario: 18 });
  assert.equal(fora.curto2, 'Tigres');
  assert.equal(fora.longo, '15/11/2026 · em Tigres · E 18–18');
});

test('a evolução de um jogador usa o que a vista mostra', () => {
  const { jogadores } = estatisticasDaEquipa(dados());
  const sete = jogadores.find((j) => j.numero === 7);
  const rui = jogadores.find((j) => j.numero === 1);
  const vista = (c) => VISTAS.find((v) => v.codigo === c);
  assert.deepEqual(serieDoJogador(sete, vista('ataque')).valores, [4, 3, 1]);
  assert.deepEqual(serieDoJogador(sete, vista('disciplina')).valores, [2, 0, 0]);
  assert.deepEqual(serieDoJogador(rui, vista('guardaRedes')).valores, [35, 22.7]);
  assert.equal(serieDoJogador(sete, vista('ataque')).categorias.length, 3);
  assert.equal(serieDoJogador(rui, vista('guardaRedes')).categorias.length, 2, 'só os jogos em que entrou');
  for (const v of VISTAS) {
    assert.ok(v.grafico?.nome && v.grafico.titulo && typeof v.grafico.valor === 'function', `${v.codigo} tem gráfico`);
    assert.ok(['inteiro', 'percentagem'].includes(v.grafico.formato));
  }
  // jogo em que não houve remates à baliza: sem valor, para a linha interromper
  const noVazio = serieDoJogador({ porJogo: [{ jogo: dados().jogos[0], ...derivados(zeros()), ...zeros() }] }, vista('guardaRedes'));
  assert.deepEqual(noVazio.valores, [null]);
});
