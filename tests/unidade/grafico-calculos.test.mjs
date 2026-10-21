// Testes das contas dos gráficos de linhas (frontend/js/grafico-calculos.js).
//   node --no-warnings --test unidade/
import assert from 'node:assert/strict';
import test from 'node:test';
import { eixoY, formatarValor, maisProximo, posicoesX, rotulosVisiveis, trocos } from '../../frontend/js/grafico-calculos.js';

test('o eixo vertical começa em 0 e acaba num número redondo', () => {
  const e = eixoY(25);
  assert.equal(e.ticks[0], 0);
  assert.ok(e.max >= 25, 'o máximo cobre os dados');
  assert.ok(e.ticks.length <= 7, 'não enche o eixo de marcas');
  assert.deepEqual(eixoY(7), { max: 8, ticks: [0, 2, 4, 6, 8] });
  assert.deepEqual(eixoY(3), { max: 3, ticks: [0, 1, 2, 3] });
  assert.deepEqual(eixoY(0), { max: 1, ticks: [0, 1] }, 'sem dados há um eixo mínimo, sem marcas fracionárias');
  assert.deepEqual(eixoY(1), { max: 1, ticks: [0, 1] });
  assert.deepEqual(eixoY(31), { max: 40, ticks: [0, 10, 20, 30, 40] });
  assert.deepEqual(eixoY(12).ticks, [0, 5, 10, 15]);
});

test('as contagens só têm marcas inteiras; as outras grandezas podem ter fracionárias', () => {
  for (const max of [1, 2, 3, 4, 5, 6, 9, 11, 17, 33, 120]) {
    const { ticks, max: topo } = eixoY(max);
    assert.ok(ticks.every(Number.isInteger), `marcas inteiras para ${max}: ${ticks}`);
    assert.ok(topo >= max);
  }
  assert.deepEqual(eixoY(0.8, { inteiros: false }).ticks, [0, 0.2, 0.4, 0.6, 0.8]);
});

test('as percentagens têm o eixo fixo em 100', () => {
  assert.deepEqual(eixoY(37, { fixo: 100 }), { max: 100, ticks: [0, 25, 50, 75, 100] });
  assert.deepEqual(eixoY(null, { fixo: 100 }).ticks.length, 5);
});

test('as posições são o centro de cada faixa e o ponto mais próximo acha-se pelo X', () => {
  assert.deepEqual(posicoesX(4, 0, 400), [50, 150, 250, 350]);
  assert.deepEqual(posicoesX(1, 40, 240), [140], 'com um só jogo o ponto fica ao meio');
  assert.deepEqual(posicoesX(0, 0, 100), []);
  const p = posicoesX(4, 0, 400);
  assert.equal(maisProximo(0, p), 0);
  assert.equal(maisProximo(101, p), 1);
  assert.equal(maisProximo(99, p), 0);
  assert.equal(maisProximo(10000, p), 3);
  assert.equal(maisProximo(5, []), -1);
});

test('os rótulos do eixo horizontal não se sobrepõem e o último jogo nunca fica sem rótulo', () => {
  assert.deepEqual([...rotulosVisiveis(5, 80, 60)].sort(), [0, 1, 2, 3, 4], 'cabem todos');
  const muitos = rotulosVisiveis(10, 30, 60);   // um rótulo ocupa duas faixas: de dois em dois
  assert.ok(muitos.has(9) && muitos.has(7) && !muitos.has(8) && muitos.size === 5, [...muitos].join());
  assert.ok(rotulosVisiveis(1, 5, 60).has(0));
  assert.equal(rotulosVisiveis(0, 50, 60).size, 0);
});

test('um valor em falta interrompe a linha', () => {
  assert.deepEqual(trocos([1, 2, null, 4, 5, 6, null]), [
    [{ i: 0, valor: 1 }, { i: 1, valor: 2 }],
    [{ i: 3, valor: 4 }, { i: 4, valor: 5 }, { i: 5, valor: 6 }],
  ]);
  assert.deepEqual(trocos([null, null]), []);
  assert.deepEqual(trocos([0]), [[{ i: 0, valor: 0 }]], 'o zero é um valor');
  assert.deepEqual(trocos(['7', undefined, 'x']), [[{ i: 0, valor: 7 }]]);
});

test('os valores escrevem-se como inteiros, percentagens ou decimais com vírgula, e sem valor um traço', () => {
  assert.equal(formatarValor('inteiro', 7), '7');
  assert.equal(formatarValor('inteiro', 0), '0');
  assert.equal(formatarValor('percentagem', 66.666), '67%');
  assert.equal(formatarValor('percentagem', 0), '0%');
  assert.equal(formatarValor('decimal', 2.25), '2,3');
  assert.equal(formatarValor('decimal', 2), '2,0');
  for (const f of ['inteiro', 'percentagem', 'decimal']) {
    assert.equal(formatarValor(f, null), '–');
    assert.equal(formatarValor(f, undefined), '–');
  }
});
