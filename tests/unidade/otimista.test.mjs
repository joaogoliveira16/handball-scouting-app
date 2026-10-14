// Testes do estado otimista do banco (frontend/js/otimista.js): as estatísticas do servidor + os eventos ainda por enviar.
//   node --no-warnings --test unidade/
import assert from 'node:assert/strict';
import test from 'node:test';
import { aindaPorConfirmar, aplicarPendentes, estatisticasVazias, resumoParaGuardar } from '../../frontend/js/otimista.js';
import { situacaoAgora } from '../../frontend/js/numerica.js';

const CASA = 1;
const FORA = 2;
const jogo = {
  id: 9, casaId: CASA, foraId: FORA, casaNome: 'Águias', foraNome: 'Leões',
  jogadores: [
    { id: 10, equipaId: CASA, numero: 7, nome: 'Rui Alves', posicao: 'LE' },
    { id: 11, equipaId: CASA, numero: 9, nome: 'Tiago Melo', posicao: 'PV' },
    { id: 20, equipaId: FORA, numero: 5, nome: 'Nuno Reis', posicao: 'CE' },
  ],
};
const tipos = [{ codigo: 'DOIS_MINUTOS', nome: '2 minutos' }, { codigo: 'TIMEOUT', nome: 'Time-out' }, { codigo: 'REMATE', nome: 'Remate' }];
const contexto = { jogo, tipos };

let n = 0;
const pendente = (corpo) => ({ clienteId: `p-${++n}`, criadoEm: '2026-10-11T21:00:00Z', corpo: { parte: 1, situacao: 'POSICIONAL', ...corpo } });
const remate = (equipaId, jogadorId, resultado, segundoJogo = 100, extra = {}) =>
  pendente({ tipoEvento: 'REMATE', equipaId, jogadorId, resultado, x: 50, y: 40, segundoJogo, ...extra });
const servidor = () => ({
  ...estatisticasVazias(jogo),
  ultimosEventos: [{ id: 5, clienteId: 'ja-chegou', equipaId: CASA, tipo: 'REMATE', resultado: 'GOLO', parte: 1, segundoJogo: 50 }],
});
const equipa = (e, id) => e.equipas.find((x) => x.equipaId === id);

test('sem pendentes devolve as estatísticas do servidor tal e qual', () => {
  const s = servidor();
  assert.equal(aplicarPendentes(s, [], contexto), s);
});

test('um golo pendente sobe no placar e aparece primeiro nos últimos eventos, marcado como por enviar', () => {
  const s = servidor();
  const r = aplicarPendentes(s, [remate(CASA, 10, 'GOLO')], contexto);
  assert.equal(equipa(r, CASA).golos, 1);
  assert.equal(equipa(r, CASA).remates, 1);
  assert.equal(equipa(r, CASA).eficacia, 100);
  const [ultimo, anterior] = r.ultimosEventos;
  assert.equal(ultimo.pendente, true);
  assert.equal(ultimo.id, null);
  assert.equal(ultimo.jogadorNumero, 7);
  assert.equal(ultimo.jogadorNome, 'Rui Alves');
  assert.equal(ultimo.equipaNome, 'Águias');
  assert.equal(anterior.id, 5);
  assert.equal(equipa(s, CASA).golos, 0, 'o original não foi alterado');
});

test('um golo pendente com local na baliza mostra a zona onde entrou; sem local fica sem zona', () => {
  const com = aplicarPendentes(servidor(), [remate(CASA, 10, 'GOLO', 100, { balizaX: 15, balizaY: 10 })], contexto);
  assert.equal(com.ultimosEventos[0].balizaZona, 'ALTO_ESQ');
  const sem = aplicarPendentes(servidor(), [remate(CASA, 10, 'GOLO')], contexto);
  assert.equal(sem.ultimosEventos[0].balizaZona, null);
});

test('defesa, fora, poste e bloqueado contam como remates sem golo', () => {
  const r = aplicarPendentes(servidor(), [
    remate(FORA, 20, 'DEFESA'), remate(FORA, 20, 'FORA'), remate(FORA, 20, 'POSTE'), remate(FORA, 20, 'BLOQUEADO'), remate(FORA, 20, 'GOLO'),
  ], contexto);
  const e = equipa(r, FORA);
  assert.deepEqual([e.remates, e.golos, e.defesas, e.fora, e.poste, e.bloqueados], [5, 1, 1, 1, 1, 1]);
  assert.equal(e.eficacia, 20);
});

test('a defesa com o local na baliza mostra a zona', () => {
  const r = aplicarPendentes(servidor(), [remate(CASA, 10, 'DEFESA', 100, { balizaX: 80, balizaY: 90 })], contexto);
  assert.equal(r.ultimosEventos[0].balizaZona, 'BAIXO_DIR');
});

test('os pendentes mais recentes ficam à frente dos mais antigos', () => {
  const r = aplicarPendentes(servidor(), [
    pendente({ tipoEvento: 'TIMEOUT', equipaId: CASA, segundoJogo: 10 }),
    pendente({ tipoEvento: 'TIMEOUT', equipaId: FORA, segundoJogo: 20 }),
  ], contexto);
  assert.deepEqual(r.ultimosEventos.slice(0, 2).map((e) => e.equipaId), [FORA, CASA]);
  assert.equal(r.ultimosEventos[0].tipoNome, 'Time-out');
});

test('um evento que o servidor já confirmou (vem nos últimos eventos dele) não conta duas vezes', () => {
  const s = servidor();
  s.equipas[0].golos = 1;
  const jaLa = { clienteId: 'ja-chegou', corpo: { tipoEvento: 'REMATE', equipaId: CASA, jogadorId: 10, resultado: 'GOLO', segundoJogo: 50, parte: 1 } };
  const nova = remate(CASA, 10, 'GOLO');
  assert.deepEqual(aindaPorConfirmar(s, [jaLa, nova]).map((p) => p.clienteId), [nova.clienteId]);
  const r = aplicarPendentes(s, [jaLa, nova], contexto);
  assert.equal(equipa(r, CASA).golos, 2, '1 do servidor + 1 pendente');
  assert.equal(aplicarPendentes(s, [jaLa], contexto), s);
});

test('três 2 minutos do mesmo jogador: à terceira fica expulso, tal como no servidor', () => {
  const dois = (segundoJogo) => pendente({ tipoEvento: 'DOIS_MINUTOS', equipaId: CASA, jogadorId: 10, segundoJogo });
  let r = aplicarPendentes(servidor(), [dois(100), dois(400)], contexto);
  let sancao = r.sancoes.find((s) => s.jogadorId === 10);
  assert.deepEqual([sancao.doisMinutos, sancao.vermelhos, sancao.expulso, sancao.numero, sancao.nome], [2, 0, false, 7, 'Rui Alves']);
  r = aplicarPendentes(servidor(), [dois(100), dois(400), dois(700)], contexto);
  sancao = r.sancoes.find((s) => s.jogadorId === 10);
  assert.deepEqual([sancao.doisMinutos, sancao.expulso], [3, true]);
});

test('o vermelho direto expulsa logo e soma ao que o servidor já sabia', () => {
  const s = servidor();
  s.sancoes.push({ jogadorId: 11, equipaId: CASA, numero: 9, nome: 'Tiago Melo', doisMinutos: 1, vermelhos: 0, expulso: false });
  const r = aplicarPendentes(s, [pendente({ tipoEvento: 'VERMELHO', equipaId: CASA, jogadorId: 11, segundoJogo: 300 })], contexto);
  const sancao = r.sancoes.find((x) => x.jogadorId === 11);
  assert.deepEqual([sancao.doisMinutos, sancao.vermelhos, sancao.expulso], [1, 1, true]);
  assert.equal(s.sancoes[0].vermelhos, 0, 'o original não foi alterado');
});

test('um 2 minutos pendente põe a equipa a menos um (6×5) e a faixa do banco conta o tempo', () => {
  const r = aplicarPendentes(servidor(), [pendente({ tipoEvento: 'DOIS_MINUTOS', equipaId: CASA, jogadorId: 10, segundoJogo: 600 })], contexto);
  assert.equal(r.numerica.relogioUsado, true);
  const situacao = situacaoAgora(r.numerica, CASA, FORA, 660);
  assert.equal(situacao.rotulo, '6×5');
  assert.equal(situacao.favorecida, FORA);
  assert.equal(situacao.ativas[0].restante, 60);
  assert.equal(situacao.ativas[0].jogadorNumero, 7);
  assert.equal(situacaoAgora(r.numerica, CASA, FORA, 720), null, 'passados os 2 minutos a faixa desaparece');
});

test('com o relógio parado a 00:00 um 2 minutos pendente não inventa superioridade', () => {
  const r = aplicarPendentes(servidor(), [pendente({ tipoEvento: 'DOIS_MINUTOS', equipaId: CASA, jogadorId: 10, segundoJogo: 0 })], contexto);
  assert.equal(r.numerica.relogioUsado, false);
  assert.equal(situacaoAgora(r.numerica, CASA, FORA, 0), null);
});

test('ligar e desligar o 7×6 pendente muda o estado da equipa', () => {
  const ligar = pendente({ tipoEvento: 'SETE_SEIS_INICIO', equipaId: FORA, segundoJogo: 900 });
  const desligar = pendente({ tipoEvento: 'SETE_SEIS_FIM', equipaId: FORA, segundoJogo: 950 });
  const ligado = aplicarPendentes(servidor(), [ligar], contexto);
  assert.deepEqual(ligado.numerica.seteSeis.find((e) => e.equipaId === FORA), { equipaId: FORA, ativo: true, desde: 900 });
  const desligado = aplicarPendentes(servidor(), [ligar, desligar], contexto);
  assert.equal(desligado.numerica.seteSeis.find((e) => e.equipaId === FORA).ativo, false);

  // se o servidor já tinha o 7×6 ligado, o pendente "fim" desliga-o
  const s = servidor();
  s.numerica.seteSeis = [{ equipaId: FORA, ativo: true, desde: 800 }];
  assert.equal(aplicarPendentes(s, [desligar], contexto).numerica.seteSeis[0].ativo, false);
});

test('sem estatísticas do servidor (nunca houve rede) os pendentes vêm sobre um jogo vazio', () => {
  const r = aplicarPendentes(null, [remate(FORA, 20, 'GOLO')], contexto);
  assert.equal(equipa(r, FORA).golos, 1);
  assert.equal(equipa(r, CASA).golos, 0);
  assert.equal(r.ultimosEventos.length, 1);
});

test('só se guarda no tablet o que o banco usa', () => {
  const grande = { ...servidor(), remates: new Array(500).fill({}), porCorredor: [1], parcial: [2], assistente: {} };
  const resumo = resumoParaGuardar(grande);
  assert.deepEqual(Object.keys(resumo).sort(), ['equipas', 'jogoId', 'numerica', 'relogio', 'sancoes', 'ultimosEventos']);
  assert.equal(resumoParaGuardar(null), null);
});
