// Testes da contagem das sanções "agora" (frontend/js/numerica.js).
//   node --no-warnings --test unidade/
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatarRestante, jogadoresAMenos, sancoesAtivas, segundoAgora, situacaoAgora,
} from '../../frontend/js/numerica.js';

const CASA = 1;
const FORA = 2;
let ids = 0;
const dois = (equipaId, segundoJogo, numero = 7, tipo = 'DOIS_MINUTOS') =>
  ({ eventoId: ++ids, equipaId, jogadorNumero: numero, tipo, segundoJogo });
const numerica = (suspensoes = [], seteSeis = []) =>
  ({ relogioUsado: true, duracaoSegundos: 120, suspensoes, seteSeis });

test('uma sanção dura 120 segundos e mostra quanto falta', () => {
  const s = [dois(CASA, 600)];
  assert.equal(sancoesAtivas(s, 599).length, 0);
  assert.equal(sancoesAtivas(s, 600)[0].restante, 120);
  assert.equal(sancoesAtivas(s, 660)[0].restante, 60);
  assert.equal(sancoesAtivas(s, 719)[0].restante, 1);
  assert.equal(sancoesAtivas(s, 720).length, 0);
});

test('as sanções vêm ordenadas pela que acaba primeiro', () => {
  const s = [dois(CASA, 700, 9), dois(FORA, 650, 4)];
  assert.deepEqual(sancoesAtivas(s, 720).map((x) => x.jogadorNumero), [4, 9]);
});

test('no máximo 2 jogadores a menos por equipa', () => {
  const s = [dois(CASA, 600), dois(CASA, 610), dois(CASA, 620)];
  assert.equal(jogadoresAMenos(s, CASA, 630), 2);
  assert.equal(jogadoresAMenos(s, FORA, 630), 0);
});

test('o vermelho direto também conta', () => {
  assert.equal(jogadoresAMenos([dois(FORA, 100, 3, 'VERMELHO')], FORA, 150), 1);
});

test('sem sanções nem 7×6 não há situação especial', () => {
  assert.equal(situacaoAgora(numerica(), CASA, FORA, 300), null);
  assert.equal(situacaoAgora(numerica([dois(CASA, 600)]), CASA, FORA, 800), null); // já acabou
});

test('sem o relógio usado não se diz nada', () => {
  assert.equal(situacaoAgora({ ...numerica([dois(CASA, 0)]), relogioUsado: false }, CASA, FORA, 30), null);
  assert.equal(situacaoAgora(undefined, CASA, FORA, 30), null);
});

test('uma sanção da casa dá 5×6 ao adversário: favorecida é a visitante', () => {
  const r = situacaoAgora(numerica([dois(CASA, 600)]), CASA, FORA, 650);
  assert.equal(r.favorecida, FORA);
  assert.equal(r.rotulo, '6×5');
  assert.deepEqual(r.aMenos, { [CASA]: 1, [FORA]: 0 });
  assert.equal(r.ativas.length, 1);
});

test('uma sanção de cada lado é igualdade em 5×5', () => {
  const r = situacaoAgora(numerica([dois(CASA, 600), dois(FORA, 620)]), CASA, FORA, 650);
  assert.equal(r.favorecida, null);
  assert.equal(r.rotulo, '5×5');
});

test('duas sanções contra uma é 5×4 para quem tem mais jogadores', () => {
  const r = situacaoAgora(numerica([dois(FORA, 600), dois(FORA, 610), dois(CASA, 620)]), CASA, FORA, 650);
  assert.equal(r.favorecida, CASA); // fora joga com 4 e a casa com 5
  assert.equal(r.rotulo, '5×4');
});

test('duas a menos contra nenhuma é 6×4', () => {
  const r = situacaoAgora(numerica([dois(FORA, 600), dois(FORA, 610)]), CASA, FORA, 650);
  assert.equal(r.favorecida, CASA);
  assert.equal(r.rotulo, '6×4');
});

test('o 7×6 aparece mesmo sem sanções', () => {
  const r = situacaoAgora(numerica([], [{ equipaId: FORA, ativo: true, desde: 900 }, { equipaId: CASA, ativo: false, desde: null }]), CASA, FORA, 950);
  assert.deepEqual(r.seteSeis, [FORA]);
  assert.equal(r.rotulo, null);
  assert.equal(r.ativas.length, 0);
});

test('o segundo avança com o tempo que passou desde que o relógio chegou, mas só se estiver a andar', () => {
  assert.equal(segundoAgora({ segundo: 600, aCorrer: true }, 10_000, 14_900), 604);
  assert.equal(segundoAgora({ segundo: 600, aCorrer: false }, 10_000, 14_900), 600);
  assert.equal(segundoAgora({ segundo: 600, aCorrer: true }, 10_000, 9_000), 600); // relógio do browser atrasado
  assert.equal(segundoAgora(null, 0), 0);
});

test('formatarRestante arredonda para cima', () => {
  assert.equal(formatarRestante(72), '1:12');
  assert.equal(formatarRestante(0.2), '0:01');
  assert.equal(formatarRestante(0), '0:00');
  assert.equal(formatarRestante(-5), '0:00');
  assert.equal(formatarRestante(120), '2:00');
});
