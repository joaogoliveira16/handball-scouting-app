// Testes das contas do dashboard feitas no browser (frontend/js/analise.js):
// a eficácia contra cada defesa do adversário e o livro dos 7 metros.
//   node --no-warnings --test unidade/
import assert from 'node:assert/strict';
import test from 'node:test';
import { eficaciaPorSistema, livroSeteMetros } from '../../frontend/js/analise.js';

const CASA = 1;
const FORA = 2;
let ids = 0;
const remate = (equipaId, resultado, extra = {}) => ({
  id: ++ids, equipaId, jogadorId: 10 + equipaId, jogadorNumero: 7, resultado, situacao: 'POSICIONAL',
  balizaX: null, balizaY: null, balizaZona: null, sistemaDefensivo: null, ...extra,
});
const contra = (sistema, equipaId, resultados) => resultados.map((r) => remate(equipaId, r, { sistemaDefensivo: sistema }));

// ------------------------- Eficácia contra cada defesa -------------------------

test('a eficácia conta-se por defesa, pela ordem 6:0, 5:1, 3:2:1, 4:2, individual, com os sem defesa no fim', () => {
  const remates = [
    ...contra('5_1', CASA, ['GOLO', 'GOLO', 'DEFESA', 'GOLO']),
    ...contra('6_0', CASA, ['GOLO', 'FORA', 'FORA', 'DEFESA']),
    remate(CASA, 'GOLO'),
    ...contra('INDIVIDUAL', CASA, ['POSTE']),
  ];
  const { linhas, marcados } = eficaciaPorSistema(remates, CASA);
  assert.deepEqual(linhas.map((l) => [l.sistema, l.remates, l.golos, l.eficacia]), [
    ['6_0', 4, 1, 25],
    ['5_1', 4, 3, 75],
    ['INDIVIDUAL', 1, 0, 0],
    [null, 1, 1, 100],
  ]);
  assert.equal(marcados, true);
});

test('só entram os remates posicionais da equipa pedida', () => {
  const remates = [
    ...contra('6_0', FORA, ['GOLO', 'GOLO']),                                  // outra equipa
    remate(CASA, 'GOLO', { situacao: 'CONTRA_ATAQUE', sistemaDefensivo: null }),  // sem defesa montada
    remate(CASA, 'GOLO', { situacao: 'SETE_METROS' }),
    ...contra('6_0', CASA, ['GOLO']),
  ];
  const { linhas } = eficaciaPorSistema(remates, CASA);
  assert.deepEqual(linhas.map((l) => [l.sistema, l.remates]), [['6_0', 1]]);
});

test('melhor e pior só aparecem com pelo menos duas defesas com remates que cheguem', () => {
  const quatro = (sistema, resultados) => contra(sistema, CASA, resultados);
  const comparavel = eficaciaPorSistema([
    ...quatro('6_0', ['GOLO', 'FORA', 'FORA', 'FORA']),     // 25 %
    ...quatro('5_1', ['GOLO', 'GOLO', 'GOLO', 'FORA']),     // 75 %
    ...contra('3_2_1', CASA, ['GOLO']),                      // 100 %, mas só 1 remate: não conta
  ], CASA);
  assert.equal(comparavel.melhor.sistema, '5_1');
  assert.equal(comparavel.pior.sistema, '6_0');

  const poucos = eficaciaPorSistema([...quatro('6_0', ['GOLO', 'FORA', 'FORA', 'FORA']), ...contra('5_1', CASA, ['GOLO', 'GOLO'])], CASA);
  assert.equal(poucos.melhor, null);
  assert.equal(poucos.pior, null);

  const iguais = eficaciaPorSistema([...quatro('6_0', ['GOLO', 'FORA', 'FORA', 'FORA']), ...quatro('5_1', ['FORA', 'GOLO', 'FORA', 'FORA'])], CASA);
  assert.equal(iguais.melhor, null, 'com a mesma eficácia não há melhor nem pior');
});

test('os sem defesa marcada nunca são o melhor nem o pior', () => {
  const resultado = eficaciaPorSistema([
    ...Array.from({ length: 5 }, () => remate(CASA, 'GOLO')),
    ...contra('6_0', CASA, ['GOLO', 'FORA', 'FORA', 'FORA']),
  ], CASA);
  assert.equal(resultado.melhor, null);
  assert.equal(resultado.marcados, true);
});

test('sem nenhuma defesa marcada diz-se isso, e sem remates não há linhas', () => {
  assert.equal(eficaciaPorSistema([remate(CASA, 'GOLO'), remate(CASA, 'FORA')], CASA).marcados, false);
  assert.deepEqual(eficaciaPorSistema([], CASA).linhas, []);
});

// ------------------------- Livro dos 7 metros -------------------------

const sete = (equipaId, jogadorId, numero, resultado, local = null) => remate(equipaId, resultado, {
  situacao: 'SETE_METROS', jogadorId, jogadorNumero: numero,
  ...(local ? { balizaX: local[0], balizaY: local[1], balizaZona: local[2] } : {}),
});

test('o livro conta por lançador, só os 7 metros da equipa, do que mais lançou para o que menos', () => {
  const remates = [
    sete(CASA, 21, 9, 'GOLO', [90, 90, 'BAIXO_DIR']),
    sete(CASA, 21, 9, 'GOLO', [85, 80, 'BAIXO_DIR']),
    sete(CASA, 21, 9, 'DEFESA', [88, 92, 'BAIXO_DIR']),
    sete(CASA, 21, 9, 'FORA'),
    sete(CASA, 22, 6, 'GOLO', [10, 10, 'ALTO_ESQ']),
    sete(FORA, 31, 4, 'GOLO', [50, 50, 'MEIO_CENTRO']),         // outra equipa
    remate(CASA, 'GOLO', { jogadorId: 21, jogadorNumero: 9 }),  // não é um 7 metros
  ];
  const { lancadores, total } = livroSeteMetros(remates, CASA);
  assert.deepEqual(lancadores.map((l) => l.numero), [9, 6]);
  assert.deepEqual(total, { lancamentos: 5, golos: 3, defendidos: 1, eficacia: 60 });

  const nove = lancadores[0];
  assert.deepEqual([nove.lancamentos, nove.golos, nove.defendidos, nove.outros, nove.eficacia], [4, 2, 1, 1, 50]);
  assert.deepEqual(nove.porZona, { BAIXO_DIR: 3 });
  assert.equal(nove.comLocal, 3);
  assert.equal(nove.semLocal, 0, 'o fora não tem local na baliza e não conta como «sem local»');
});

test('a zona preferida pede 3 lançamentos com local e uma zona que ganhe às outras', () => {
  const tres = livroSeteMetros([
    sete(CASA, 21, 9, 'GOLO', [90, 90, 'BAIXO_DIR']), sete(CASA, 21, 9, 'GOLO', [85, 80, 'BAIXO_DIR']), sete(CASA, 21, 9, 'DEFESA', [10, 10, 'ALTO_ESQ']),
  ], CASA).lancadores[0];
  assert.deepEqual(tres.tendencia, { zona: 'BAIXO_DIR', total: 2, de: 3 });

  const poucos = livroSeteMetros([
    sete(CASA, 21, 9, 'GOLO', [90, 90, 'BAIXO_DIR']), sete(CASA, 21, 9, 'GOLO', [85, 80, 'BAIXO_DIR']),
  ], CASA).lancadores[0];
  assert.equal(poucos.tendencia, null, 'com 2 lançamentos ainda não há tendência');

  const empate = livroSeteMetros([
    sete(CASA, 21, 9, 'GOLO', [90, 90, 'BAIXO_DIR']), sete(CASA, 21, 9, 'GOLO', [10, 10, 'ALTO_ESQ']), sete(CASA, 21, 9, 'DEFESA', [50, 50, 'MEIO_CENTRO']),
  ], CASA).lancadores[0];
  assert.equal(empate.tendencia, null, 'três zonas iguais não são uma tendência');
});

test('golos e defesas sem local contam em «sem local»', () => {
  const [lancador] = livroSeteMetros([
    sete(CASA, 21, 9, 'GOLO'), sete(CASA, 21, 9, 'DEFESA'), sete(CASA, 21, 9, 'GOLO', [90, 90, 'BAIXO_DIR']),
  ], CASA).lancadores;
  assert.equal(lancador.semLocal, 2);
  assert.equal(lancador.comLocal, 1);
});

test('sem 7 metros o livro está vazio', () => {
  const { lancadores, total } = livroSeteMetros([remate(CASA, 'GOLO')], CASA);
  assert.deepEqual(lancadores, []);
  assert.deepEqual(total, { lancamentos: 0, golos: 0, defendidos: 0, eficacia: null });
});
