// Testes das contas da página «Eventos do jogo» (frontend/js/eventos-jogo.js): o minuto, os valores do formulário,
// o corpo que vai para a API, o que está mal, trocar de equipa e os filtros.
//   node --no-warnings --test unidade/
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  corpoDoEvento, erros, filtrarEventos, guardaRedesAdversarios, jogadoresDaEquipa, lerMinuto, mudarEquipa, mudarResultado,
  mudarSituacao, mudou, textoMinuto, valoresDoEvento,
} from '../../frontend/js/eventos-jogo.js';

const CASA = 1;
const FORA = 2;
const jogo = { casaId: CASA, foraId: FORA };
const jogadores = [
  { id: 11, equipaId: CASA, numero: 9, nome: 'Miguel', posicao: 'PD' },
  { id: 10, equipaId: CASA, numero: 1, nome: 'Rui', posicao: 'GR' },
  { id: 21, equipaId: FORA, numero: 12, nome: 'Zé', posicao: 'GR' },
  { id: 22, equipaId: FORA, numero: 3, nome: 'Leo', posicao: 'LE' },
  { id: 23, equipaId: FORA, numero: 1, nome: 'Bruno', posicao: 'GR' },
];

/** Um remate como a API o devolve (os números do PostgreSQL chegam como números). */
const remate = (extra = {}) => ({
  id: 5, equipaId: CASA, tipoEvento: 'REMATE', tipoNome: 'Remate', eRemate: true,
  jogadorId: 11, jogadorNumero: 9, jogadorNome: 'Miguel', guardaRedesId: 21, guardaRedesNumero: 12, guardaRedesNome: 'Zé',
  resultado: 'GOLO', situacao: 'POSICIONAL', x: 30, y: 40.5, balizaX: 80, balizaY: 10, balizaZona: 'ALTO_DIR',
  sistemaDefensivo: '6_0', parte: 1, segundoJogo: 754, ...extra,
});
const doisMinutos = (extra = {}) => ({
  id: 6, equipaId: FORA, tipoEvento: 'DOIS_MINUTOS', tipoNome: '2 minutos', eRemate: false,
  jogadorId: 22, jogadorNumero: 3, jogadorNome: 'Leo', guardaRedesId: null, resultado: null, situacao: 'POSICIONAL',
  x: null, y: null, balizaX: null, balizaY: null, sistemaDefensivo: null, parte: 2, segundoJogo: 2400, ...extra,
});

test('o minuto escreve-se e lê-se como minutos e segundos', () => {
  assert.equal(textoMinuto(754), '12:34');
  assert.equal(textoMinuto(0), '00:00');
  assert.equal(textoMinuto(3605), '60:05');
  assert.equal(textoMinuto(-5), '00:00');
  assert.equal(lerMinuto('12:34'), 754);
  assert.equal(lerMinuto(' 2:05 '), 125);
  assert.equal(lerMinuto('7'), 420, 'só minutos: 7 são 7 minutos');
  assert.equal(lerMinuto('120:00'), 7200, 'o limite da API');
  for (const mau of ['', '12:60', '12:5', 'abc', '-1:00', '120:01', '1:2:3', null, undefined, '12,5']) {
    assert.equal(lerMinuto(mau), null, `${JSON.stringify(mau)} não é um minuto`);
  }
  for (const segundos of [0, 59, 60, 754, 1800, 7200]) assert.equal(lerMinuto(textoMinuto(segundos)), segundos);
});

test('os valores do formulário saem do evento tal como está guardado', () => {
  const v = valoresDoEvento(remate({ x: '30.00', y: '40.50', balizaX: '80.00', balizaY: '10.00' }));
  assert.deepEqual(v, {
    tipo: 'REMATE', eRemate: true, equipaId: CASA, jogadorId: 11, guardaRedesId: 21, resultado: 'GOLO', situacao: 'POSICIONAL',
    sistemaDefensivo: '6_0', parte: 1, minuto: '12:34', x: 30, y: 40.5, balizaX: 80, balizaY: 10,
  });
  const outro = valoresDoEvento(doisMinutos());
  assert.equal(outro.eRemate, false);
  assert.equal(outro.minuto, '40:00');
  assert.equal(outro.x, null);
});

test('sem mexer em nada o corpo é o do evento e não há nada para guardar', () => {
  const e = remate();
  const v = valoresDoEvento(e);
  assert.deepEqual(corpoDoEvento(v), {
    tipoEvento: 'REMATE', equipaId: CASA, jogadorId: 11, parte: 1, segundoJogo: 754, guardaRedesId: 21, resultado: 'GOLO',
    situacao: 'POSICIONAL', x: 30, y: 40.5, balizaX: 80, balizaY: 10, sistemaDefensivo: '6_0',
  });
  assert.equal(mudou(v, valoresDoEvento(e)), false);
  assert.equal(mudou(v, { ...v, jogadorId: 12 }), true);
  assert.equal(mudou(v, { ...v, minuto: '12:35' }), true);
  assert.equal(mudou(v, { ...v, minuto: '12:34' }), false, 'escrever o mesmo minuto não é mudar');
  assert.deepEqual(erros(v), []);
});

test('o que não faz sentido para o tipo vai a null (a API recusa coordenadas num 2 minutos)', () => {
  const corpo = corpoDoEvento({ ...valoresDoEvento(doisMinutos()), x: 10, y: 10, resultado: 'GOLO', guardaRedesId: 21, balizaX: 1, balizaY: 1, sistemaDefensivo: '6_0' });
  assert.deepEqual(corpo, {
    tipoEvento: 'DOIS_MINUTOS', equipaId: FORA, jogadorId: 22, parte: 2, segundoJogo: 2400, guardaRedesId: null, resultado: null,
    situacao: null, x: null, y: null, balizaX: null, balizaY: null, sistemaDefensivo: null,
  });
});

test('o local na baliza só fica numa defesa ou num golo, e a defesa do adversário só no ataque posicional', () => {
  const golo = valoresDoEvento(remate());
  const fora = mudarResultado(golo, 'FORA');
  assert.equal(fora.balizaX, null);
  assert.equal(corpoDoEvento(fora).balizaX, null);
  assert.equal(mudarResultado(golo, 'DEFESA').balizaX, 80, 'de golo para defesa o sítio mantém-se');
  // mesmo que sobre um valor de antes, o corpo não o leva
  assert.equal(corpoDoEvento({ ...golo, resultado: 'POSTE' }).balizaY, null);
  assert.equal(corpoDoEvento({ ...golo, balizaY: null }).balizaX, null, 'os dois pontos vêm juntos');

  const contra = mudarSituacao(golo, 'CONTRA_ATAQUE');
  assert.equal(contra.sistemaDefensivo, null);
  assert.equal(corpoDoEvento(contra).sistemaDefensivo, null);
  assert.equal(corpoDoEvento({ ...golo, situacao: 'SETE_METROS' }).sistemaDefensivo, null);
  assert.equal(corpoDoEvento({ ...golo, sistemaDefensivo: null }).sistemaDefensivo, null);
});

test('o que está mal, em português, antes de enviar', () => {
  const v = valoresDoEvento(remate());
  assert.deepEqual(erros({ ...v, minuto: '12:75' }), ['Escreve o minuto como minutos e segundos, por exemplo 12:34.']);
  assert.deepEqual(erros({ ...v, parte: 3 }), ['Escolhe a parte.']);
  assert.deepEqual(erros({ ...v, jogadorId: null }), ['Escolhe o jogador.']);
  assert.deepEqual(erros({ ...v, resultado: null }), ['Escolhe o resultado do remate.']);
  assert.deepEqual(erros({ ...v, x: null, y: null }), ['Toca no mapa para marcar de onde foi o remate.']);
  assert.equal(erros({ ...v, jogadorId: null, resultado: null, x: null, minuto: 'x' }).length, 4, 'diz tudo o que falta de uma vez');
  // fora do remate, o jogador é opcional, menos no vermelho direto
  const falta = valoresDoEvento(doisMinutos({ tipoEvento: 'PERDA_BOLA', jogadorId: null }));
  assert.deepEqual(erros(falta), []);
  assert.deepEqual(erros({ ...falta, tipo: 'VERMELHO' }), ['Escolhe o jogador.']);
});

test('as listas do formulário: jogadores da equipa e guarda-redes de quem defende', () => {
  assert.deepEqual(jogadoresDaEquipa(jogadores, CASA).map((j) => j.numero), [1, 9]);
  assert.deepEqual(jogadoresDaEquipa(jogadores, FORA).map((j) => j.id), [23, 22, 21]);
  // quem ataca é a casa: os guarda-redes são os de fora, por número
  assert.deepEqual(guardaRedesAdversarios(jogadores, CASA, jogo).map((j) => j.id), [23, 21]);
  // quem ataca é a equipa de fora: o guarda-redes é o da casa
  assert.deepEqual(guardaRedesAdversarios(jogadores, FORA, jogo).map((j) => j.id), [10]);
});

test('passar o evento à outra equipa limpa o jogador e o guarda-redes, que já não servem', () => {
  const v = valoresDoEvento(remate());
  const outra = mudarEquipa(v, FORA);
  assert.equal(outra.equipaId, FORA);
  assert.equal(outra.jogadorId, null);
  assert.equal(outra.guardaRedesId, null);
  assert.equal(outra.x, 30, 'o resto fica como estava');
  assert.equal(mudarEquipa(v, CASA), v, 'a mesma equipa não muda nada');
  assert.deepEqual(erros(outra), ['Escolhe o jogador.']);
});

test('os filtros da lista de eventos', () => {
  const eventos = [remate({ id: 1 }), remate({ id: 2, equipaId: FORA, jogadorId: 22, parte: 2 }), doisMinutos({ id: 3 }), doisMinutos({ id: 4, equipaId: CASA, jogadorId: 11, parte: 1 })];
  const ids = (filtro) => filtrarEventos(eventos, filtro).map((e) => e.id);
  assert.deepEqual(ids({}), [1, 2, 3, 4]);
  assert.deepEqual(ids({ grupo: 'remates' }), [1, 2]);
  assert.deepEqual(ids({ grupo: 'outros' }), [3, 4]);
  assert.deepEqual(ids({ equipaId: CASA }), [1, 4]);
  assert.deepEqual(ids({ parte: 2 }), [2, 3]);
  assert.deepEqual(ids({ jogadorId: 11 }), [1, 4]);
  assert.deepEqual(ids({ equipaId: CASA, grupo: 'outros', parte: 1 }), [4]);
  assert.deepEqual(ids({ equipaId: 99 }), []);
});
