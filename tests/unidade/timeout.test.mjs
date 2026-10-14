// Testes do minuto do time-out (frontend/js/timeout.js).
//   node --no-warnings --test unidade/
import assert from 'node:assert/strict';
import test from 'node:test';
import { DURACAO_TIMEOUT_S, estadoTimeout, novoTimeout } from '../../frontend/js/timeout.js';

const T0 = 1_700_000_000_000;

test('um time-out dura 1 minuto', () => {
  assert.equal(DURACAO_TIMEOUT_S, 60);
  const t = novoTimeout(7, T0);
  assert.equal(t.equipaId, 7);
  assert.equal(t.ate, T0 + 60_000);
  assert.deepEqual(estadoTimeout(t, T0), { restante: 60, acabou: false });
});

test('o minuto desconta segundo a segundo (arredondado para cima)', () => {
  const t = novoTimeout(1, T0);
  assert.equal(estadoTimeout(t, T0 + 1).restante, 60);        // acabou de começar
  assert.equal(estadoTimeout(t, T0 + 1_000).restante, 59);
  assert.equal(estadoTimeout(t, T0 + 30_500).restante, 30);
  assert.equal(estadoTimeout(t, T0 + 59_999).restante, 1);    // falta um instante: ainda mostra 0:01
  assert.equal(estadoTimeout(t, T0 + 59_999).acabou, false);
});

test('ao fim do minuto fica «acabou» a zero, à espera de se retomar o jogo', () => {
  const t = novoTimeout(1, T0);
  assert.deepEqual(estadoTimeout(t, T0 + 60_000), { restante: 0, acabou: true });
  assert.deepEqual(estadoTimeout(t, T0 + 90_000), { restante: 0, acabou: true });
});

test('um time-out esquecido há mais de 5 minutos desaparece', () => {
  const t = novoTimeout(1, T0);
  assert.equal(estadoTimeout(t, T0 + 60_000 + 300_000)?.acabou, true);
  assert.equal(estadoTimeout(t, T0 + 60_000 + 301_000), null);
});

test('sem time-out (ou com dados estragados) não há estado', () => {
  assert.equal(estadoTimeout(null, T0), null);
  assert.equal(estadoTimeout(undefined, T0), null);
  assert.equal(estadoTimeout({}, T0), null);
  assert.equal(estadoTimeout({ ate: 'x' }, T0), null);
});
