// Testes dos marcos do relógio do banco (frontend/js/marcos-jogo.js): o intervalo aos 30:00 e o fim do jogo aos 60:00.
//   node --no-warnings --test unidade/
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SEGUNDOS_INTERVALO, SEGUNDOS_FIM, SEGUNDO_DO_MARCO, TEXTO_MARCO, marcoAtingido, marcosPassados, ligacaoRelatorio,
} from '../../frontend/js/marcos-jogo.js';

test('o intervalo dispara aos 30:00 da 1.ª parte, e só aí', () => {
  assert.equal(marcoAtingido(1, SEGUNDOS_INTERVALO - 1), null);
  assert.equal(marcoAtingido(1, SEGUNDOS_INTERVALO), 'intervalo');
  assert.equal(marcoAtingido(1, SEGUNDOS_INTERVALO + 40), 'intervalo', 'se o separador esteve parado, apanha o marco ao voltar');
  assert.equal(marcoAtingido(2, SEGUNDOS_INTERVALO), null, 'na 2.ª parte o minuto 30 não é marco nenhum');
});

test('o fim do jogo dispara aos 60:00 da 2.ª parte, e só aí', () => {
  assert.equal(marcoAtingido(2, SEGUNDOS_FIM - 1), null);
  assert.equal(marcoAtingido(2, SEGUNDOS_FIM), 'fim');
  assert.equal(marcoAtingido(1, SEGUNDOS_FIM), 'intervalo', 'na 1.ª parte, mesmo depois dos 60:00, o primeiro marco é o intervalo');
});

test('cada marco dispara uma só vez', () => {
  assert.equal(marcoAtingido(1, SEGUNDOS_INTERVALO, { intervalo: true }), null);
  assert.equal(marcoAtingido(2, SEGUNDOS_FIM, { intervalo: true, fim: false }), 'fim');
  assert.equal(marcoAtingido(2, SEGUNDOS_FIM, { intervalo: true, fim: true }), null);
});

test('o relógio acertado à mão ou guardado de antes não dispara os marcos que já passaram', () => {
  assert.deepEqual(marcosPassados(1, 0), { intervalo: false, fim: false });
  assert.deepEqual(marcosPassados(1, SEGUNDOS_INTERVALO - 1), { intervalo: false, fim: false });
  assert.deepEqual(marcosPassados(1, SEGUNDOS_INTERVALO), { intervalo: true, fim: false });
  assert.deepEqual(marcosPassados(2, SEGUNDOS_INTERVALO), { intervalo: true, fim: false }, 'a 2.ª parte já deixou o intervalo para trás');
  assert.deepEqual(marcosPassados(2, SEGUNDOS_FIM), { intervalo: true, fim: true });
  // Quem acerta para o minuto 35 da 1.ª parte não volta a ouvir «intervalo»
  assert.equal(marcoAtingido(1, 35 * 60, marcosPassados(1, 35 * 60)), null);
  // E quem acerta para o minuto 20 ainda o vai ouvir aos 30:00
  assert.equal(marcoAtingido(1, 30 * 60, marcosPassados(1, 20 * 60)), 'intervalo');
});

test('o relógio pára no segundo certo de cada marco', () => {
  assert.deepEqual(SEGUNDO_DO_MARCO, { intervalo: 1800, fim: 3600 });
});

test('o relatório de cada marco: o da parte no intervalo, o do jogo todo no fim', () => {
  assert.equal(ligacaoRelatorio('intervalo', 42), 'intervalo.html?jogo=42&parte=1');
  assert.equal(ligacaoRelatorio('fim', 42), 'intervalo.html?jogo=42&parte=jogo');
  assert.equal(TEXTO_MARCO.intervalo.titulo, 'Intervalo');
  assert.equal(TEXTO_MARCO.fim.titulo, 'Fim do jogo');
  assert.match(TEXTO_MARCO.intervalo.nota, /30:00/);
  assert.match(TEXTO_MARCO.fim.nota, /60:00/);
});
