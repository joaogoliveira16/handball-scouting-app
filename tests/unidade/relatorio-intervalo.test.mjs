// Testes do relatório do intervalo (frontend/js/relatorio-intervalo.js): os números da 1.ª parte e as regras
// que escolhem os pontos a corrigir e a manter.
//   node --no-warnings --test unidade/
import assert from 'node:assert/strict';
import test from 'node:test';
import { relatorioIntervalo, textoRelatorio, avisoPoucosDados, semPontosACorrigir, PONTOS_A_CORRIGIR, PONTOS_A_MANTER, MINIMO_REMATES } from '../../frontend/js/relatorio-intervalo.js';

const CASA = 1;
const FORA = 2;
const GR_CASA = 20;   // guarda-redes da casa (defende os remates da equipa de fora)
const GR_FORA = 10;

let ids = 0;
/** Um remate da 1.ª parte: por omissão posicional e sem corredor nem distância registados. `j` é o número do jogador. */
const remate = (equipaId, resultado, { j = 7, ...extra } = {}) => ({
  id: ++ids, equipaId, jogadorId: equipaId * 100 + j, jogadorNumero: j, resultado, situacao: 'POSICIONAL', parte: 1,
  corredor: null, distancia: null, guardaRedesId: equipaId === CASA ? GR_FORA : GR_CASA, balizaZona: null,
  sistemaDefensivo: null, segundoJogo: 100, ...extra,
});
const varios = (n, equipaId, resultado, extra) => Array.from({ length: n }, () => remate(equipaId, resultado, extra));

const NOMES = [
  [CASA, 9, 'Miguel Sousa'], [CASA, 7, 'Rui Costa'], [CASA, 5, 'Diogo Pires'], [FORA, 11, 'Bruno Lopes'], [FORA, 7, 'Tiago Neves'],
];
const jogadores = NOMES.map(([equipa, numero, nome]) => ({ jogadorId: equipa * 100 + numero, equipaId: equipa, numero, nome }));
const guardaRedes = [
  { jogadorId: GR_CASA, equipaId: CASA, numero: 1, nome: 'Rui Mesquita' },
  { jogadorId: GR_FORA, equipaId: FORA, numero: 16, nome: 'Nuno Viana' },
];

const estado = (remates, extra = {}) => ({
  equipas: [{ equipaId: CASA, nome: 'Águias', eCasa: true }, { equipaId: FORA, nome: 'Leões', eCasa: false }],
  remates, outrosEventosPorParte: [], jogadores, guardaRedes, sancoes: [], ...extra,
});
const outro = (equipaId, tipo, total, parte = 1) => ({ equipaId, tipo, parte, total });

/** Um jogo equilibrado de fundo: 8 remates de cada lado, 4 golos cada, nada que dispare uma regra. */
const base = () => [
  ...['GOLO', 'GOLO', 'GOLO', 'GOLO', 'FORA', 'FORA', 'DEFESA', 'DEFESA'].map((r, i) => remate(CASA, r, { j: [7, 9, 5][i % 3] })),
  ...['GOLO', 'GOLO', 'GOLO', 'GOLO', 'FORA', 'FORA', 'DEFESA', 'DEFESA'].map((r, i) => remate(FORA, r, { j: [7, 11][i % 2] })),
];
const codigos = (lista) => lista.map((p) => p.codigo);
/** O relatório com todos os pontos que as regras propõem (sem o limite de 3 e 2), para cada regra se testar sozinha. */
const todos = (estadoJogo, equipaId = CASA, parte = 1) => relatorioIntervalo(estadoJogo, equipaId, parte, { corrigir: 99, manter: 99 });

// ------------------------- Números -------------------------

test('os números contam só a parte pedida, com o resultado ao intervalo', () => {
  const r2 = [remate(CASA, 'GOLO', { parte: 2 }), remate(FORA, 'GOLO', { parte: 2 }), remate(FORA, 'GOLO', { parte: 2 })];
  const rel = relatorioIntervalo(estado([...base(), ...r2]), CASA);
  assert.deepEqual(rel.golos, { nos: 4, eles: 4 });
  assert.equal(rel.remates, 16);
  const linha = (rotulo) => rel.numeros.find((n) => n.rotulo === rotulo);
  assert.deepEqual([linha('Golos').nos, linha('Golos').eles], ['4', '4']);
  assert.deepEqual([linha('Remates').nos, linha('Remates').eles], ['8', '8']);
  assert.deepEqual([linha('Eficácia').nos, linha('Eficácia').eles], ['50%', '50%']);
  assert.equal(linha('Golos').vantagem, null, 'empate: ninguém tem vantagem');
  const parte2 = relatorioIntervalo(estado([...base(), ...r2]), CASA, 2);
  assert.deepEqual(parte2.golos, { nos: 1, eles: 2 });
});

test('a vantagem de cada linha depende de maior ou menor ser melhor', () => {
  const rel = relatorioIntervalo(estado(base(), { outrosEventosPorParte: [
    outro(CASA, 'PERDA_BOLA', 2), outro(FORA, 'PERDA_BOLA', 5), outro(CASA, 'DOIS_MINUTOS', 3), outro(FORA, 'DOIS_MINUTOS', 1),
    outro(CASA, 'PERDA_BOLA', 9, 2),   // 2.ª parte: não conta
  ] }), CASA);
  const linha = (rotulo) => rel.numeros.find((n) => n.rotulo === rotulo);
  assert.deepEqual([linha('Perdas de bola').nos, linha('Perdas de bola').eles, linha('Perdas de bola').vantagem], ['2', '5', 'nos']);
  assert.equal(linha('Exclusões de 2 minutos').vantagem, 'eles');
});

test('as linhas que não aconteceram a ninguém não aparecem', () => {
  const rel = relatorioIntervalo(estado(base()), CASA);
  const rotulos = rel.numeros.map((n) => n.rotulo);
  assert.deepEqual(rotulos, ['Golos', 'Remates', 'Eficácia', 'Perdas de bola', 'Defesas do guarda-redes']);
  const comTudo = relatorioIntervalo(estado([...base(), remate(CASA, 'GOLO', { situacao: 'SETE_METROS' }), remate(FORA, 'GOLO', { situacao: 'CONTRA_ATAQUE' })],
    { outrosEventosPorParte: [outro(CASA, 'TIMEOUT', 1), outro(FORA, 'FALTA_OFENSIVA', 2)] }), CASA);
  const todos = comTudo.numeros.map((n) => n.rotulo);
  for (const esperado of ['Golos de contra-ataque', '7 metros (golos / lançamentos)', 'Faltas ofensivas', 'Time-outs']) assert.ok(todos.includes(esperado), esperado);
  assert.equal(comTudo.numeros.find((n) => n.rotulo === '7 metros (golos / lançamentos)').nos, '1/1');
});

test('as defesas do guarda-redes contam-se com os remates à baliza da outra equipa', () => {
  const rel = relatorioIntervalo(estado(base()), CASA);
  // os 8 remates deles: 4 golos + 2 defesas = 6 à baliza contra o nosso guarda-redes; o deles recebeu o mesmo dos nossos
  const gr = rel.numeros.find((n) => n.rotulo === 'Defesas do guarda-redes');
  assert.deepEqual([gr.nos, gr.eles], ['2 (33%)', '2 (33%)']);
});

test('o relatório também se faz do ponto de vista da outra equipa', () => {
  const rel = relatorioIntervalo(estado([...base(), ...varios(4, FORA, 'GOLO', { j: 11, corredor: 'PONTA_ESQ' })]), FORA);
  assert.equal(rel.nos.nome, 'Leões');
  assert.equal(rel.eles.nome, 'Águias');
  assert.deepEqual(rel.golos, { nos: 8, eles: 4 });
});

test('poucos remates avisam que os pontos podem enganar', () => {
  assert.equal(relatorioIntervalo(estado(base().slice(0, 4)), CASA).poucosDados, true);
  assert.equal(relatorioIntervalo(estado(base()), CASA).poucosDados, false);
  assert.equal(MINIMO_REMATES, 8);
  assert.deepEqual(relatorioIntervalo(estado([]), CASA).corrigir, []);
});

test('os jogadores que rematam vêm do que mais marcou para o que menos', () => {
  const rel = relatorioIntervalo(estado([...varios(3, CASA, 'GOLO', { j: 9 }), ...varios(2, CASA, 'FORA', { j: 7 }), remate(CASA, 'GOLO', { j: 7 })]), CASA);
  assert.deepEqual(rel.jogadores.map((j) => [j.numero, j.nome, j.remates, j.golos]), [[9, 'Miguel Sousa', 3, 3], [7, 'Rui Costa', 3, 1]]);
});

// ------------------------- Regras: perdas de bola -------------------------

test('perdas de bola nossas a mais pedem para cuidar da bola', () => {
  const rel = todos(estado(base(), { outrosEventosPorParte: [outro(CASA, 'PERDA_BOLA', 7), outro(FORA, 'PERDA_BOLA', 3)] }), CASA);
  const ponto = rel.corrigir.find((p) => p.codigo === 'perdas_nossas');
  assert.equal(ponto.titulo, 'Cuidar da bola');
  assert.equal(ponto.detalhe, '7 perdas de bola (adversário: 3).');
  // 4 contra 1 também (a diferença é grande); 5 contra 4 não
  const quatro = todos(estado(base(), { outrosEventosPorParte: [outro(CASA, 'PERDA_BOLA', 4), outro(FORA, 'PERDA_BOLA', 1)] }), CASA);
  assert.ok(codigos(quatro.corrigir).includes('perdas_nossas'));
  const parecido = todos(estado(base(), { outrosEventosPorParte: [outro(CASA, 'PERDA_BOLA', 5), outro(FORA, 'PERDA_BOLA', 4)] }), CASA);
  assert.ok(!codigos(parecido.corrigir).includes('perdas_nossas'));
});

test('perdas de bola do adversário são para aproveitar', () => {
  const rel = todos(estado(base(), { outrosEventosPorParte: [outro(CASA, 'PERDA_BOLA', 2), outro(FORA, 'PERDA_BOLA', 7)] }), CASA);
  const ponto = rel.manter.find((p) => p.codigo === 'perdas_deles');
  assert.equal(ponto.titulo, 'Aproveitar as perdas de bola do adversário');
  assert.match(ponto.detalhe, /perdeu a bola 7 vezes \(nós: 2\)/);
});

// ------------------------- Regras: jogadores -------------------------

test('o jogador que falha muito é para rever, com o que correu mal', () => {
  const falhas = [...varios(1, CASA, 'GOLO', { j: 9 }), ...varios(3, CASA, 'FORA', { j: 9 }), ...varios(2, CASA, 'DEFESA', { j: 9 })];
  const rel = todos(estado([...base().filter((r) => r.jogadorNumero !== 9), ...falhas]), CASA);
  const ponto = rel.corrigir.find((p) => p.codigo === 'jogador_a_falhar');
  assert.equal(ponto.titulo, 'Rever o #9 Miguel Sousa');
  assert.equal(ponto.detalhe, '1 golo em 6 remates (3 fora, 2 defendidos).');
  const poucos = todos(estado([...base().filter((r) => r.jogadorNumero !== 9), ...varios(3, CASA, 'FORA', { j: 9 })]), CASA);
  assert.ok(!codigos(poucos.corrigir).includes('jogador_a_falhar'), 'com 3 remates ainda é cedo');
});

test('o jogador em forma é para procurar', () => {
  const rel = todos(estado([...base().filter((r) => r.jogadorNumero !== 7 || r.equipaId !== CASA), ...varios(4, CASA, 'GOLO', { j: 7 }), remate(CASA, 'FORA', { j: 7 })]), CASA);
  const ponto = rel.manter.find((p) => p.codigo === 'jogador_a_marcar');
  assert.equal(ponto.titulo, 'Procurar o #7 Rui Costa');
  assert.equal(ponto.detalhe, '4 golos em 5 remates (80%).');
});

test('o jogador deles que mais marca é para marcar de perto', () => {
  const rel = todos(estado([...base().filter((r) => r.equipaId === CASA), ...varios(4, FORA, 'GOLO', { j: 11 }), ...varios(2, FORA, 'FORA', { j: 7 }), remate(FORA, 'GOLO', { j: 7 })]), CASA);
  const ponto = rel.corrigir.find((p) => p.codigo === 'jogador_perigoso');
  assert.equal(ponto.titulo, 'Marcar o #11 Bruno Lopes');
  assert.equal(ponto.detalhe, '4 dos 5 golos do adversário, em 4 remates.');
  // 3 golos só contam se forem pelo menos 40 % dos golos deles (aqui são 3 em 8)
  const diluido = todos(estado([...base().filter((r) => r.equipaId === CASA), ...varios(3, FORA, 'GOLO', { j: 11 }), ...varios(3, FORA, 'GOLO', { j: 7 }), ...varios(2, FORA, 'GOLO', { j: 5 })]), CASA);
  assert.ok(!codigos(diluido.corrigir).includes('jogador_perigoso'));
});

// ------------------------- Regras: finalização e defesa -------------------------

test('a eficácia da equipa só conta com remates que cheguem', () => {
  const fraca = todos(estado([...varios(3, CASA, 'GOLO'), ...varios(7, CASA, 'FORA'), ...varios(6, FORA, 'GOLO')]), CASA);
  const ponto = fraca.corrigir.find((p) => p.codigo === 'finalizacao_fraca');
  assert.equal(ponto.titulo, 'Melhorar a finalização');
  assert.equal(ponto.detalhe, '3 golos em 10 remates (30%); o adversário leva 100%.');
  const poucos = todos(estado([...varios(2, CASA, 'GOLO'), ...varios(7, CASA, 'FORA')]), CASA);
  assert.ok(!codigos(poucos.corrigir).includes('finalizacao_fraca'), 'com 9 remates ainda é cedo');
  const boa = todos(estado([...varios(7, CASA, 'GOLO'), ...varios(3, CASA, 'FORA')]), CASA);
  assert.equal(boa.manter.find((p) => p.codigo === 'finalizacao_boa').titulo, 'Finalização a funcionar');
});

test('a defesa cede ou aguenta conforme o que o adversário marca', () => {
  const cede = todos(estado([...varios(7, FORA, 'GOLO'), ...varios(3, FORA, 'FORA')]), CASA);
  assert.equal(cede.corrigir.find((p) => p.codigo === 'defesa_a_ceder').detalhe, 'O adversário marca 7 em 10 remates (70%).');
  const aguenta = todos(estado([...varios(3, FORA, 'GOLO'), ...varios(8, FORA, 'FORA')]), CASA);
  assert.equal(aguenta.manter.find((p) => p.codigo === 'defesa_a_funcionar').detalhe, 'O adversário só marcou 3 em 11 remates (27%).');
});

// ------------------------- Regras: de onde se remata e se sofre -------------------------

test('uma distância a falhar é apontada, com a melhor alternativa', () => {
  const remates = [...varios(1, CASA, 'GOLO', { distancia: 'MAIS_9M' }), ...varios(5, CASA, 'FORA', { distancia: 'MAIS_9M' }),
    ...varios(3, CASA, 'GOLO', { distancia: 'ATE_6M' }), remate(CASA, 'DEFESA', { distancia: 'ATE_6M' })];
  const ponto = todos(estado(remates), CASA).corrigir.find((p) => p.codigo === 'zona_fraca');
  assert.equal(ponto.titulo, 'Remates de longe a falhar');
  assert.equal(ponto.detalhe, '1 golo em 6 remates (17%) de mais de 11 m. Melhor até 6 m: 3 em 4.');
});

test('um corredor a falhar também é apontado', () => {
  const remates = [...varios(5, CASA, 'FORA', { corredor: 'PONTA_ESQ' }), remate(CASA, 'GOLO', { corredor: 'PONTA_ESQ' }),
    ...varios(4, CASA, 'GOLO', { corredor: 'LATERAL_DIR' }), remate(CASA, 'FORA', { corredor: 'LATERAL_DIR' })];
  const rel = todos(estado(remates), CASA);
  const ponto = rel.corrigir.find((p) => p.codigo === 'zona_fraca');
  assert.equal(ponto.titulo, 'Ataque pela ponta esquerda a falhar');
  assert.match(ponto.detalhe, /1 golo em 6 remates \(17%\) pela ponta esquerda\. Melhor pelo lateral direito: 4 em 5\./);
  assert.equal(rel.manter.find((p) => p.codigo === 'zona_boa').titulo, 'Insistir pelo lateral direito');
});

test('o corredor por onde o adversário nos marca mais é para fechar', () => {
  const sofridos = [...varios(5, FORA, 'GOLO', { corredor: 'PONTA_ESQ' }), ...varios(4, FORA, 'GOLO', { corredor: 'CENTRAL' })];
  const ponto = todos(estado(sofridos), CASA).corrigir.find((p) => p.codigo === 'corredor_sofrido');
  assert.equal(ponto.titulo, 'Fechar a ponta esquerda');
  assert.equal(ponto.detalhe, 'O adversário marcou 5 dos 9 golos a partir da ponta esquerda.');
  const espalhados = todos(estado([...varios(3, FORA, 'GOLO', { corredor: 'PONTA_ESQ' }), ...varios(3, FORA, 'GOLO', { corredor: 'CENTRAL' }), ...varios(3, FORA, 'GOLO', { corredor: 'LATERAL_DIR' })]), CASA);
  assert.ok(!codigos(espalhados.corrigir).includes('corredor_sofrido'));
});

test('contra-ataques sofridos e feitos', () => {
  const rel = todos(estado([...base(), ...varios(3, FORA, 'GOLO', { situacao: 'CONTRA_ATAQUE' }), ...varios(3, CASA, 'GOLO', { situacao: 'CONTRA_ATAQUE' }), remate(CASA, 'FORA', { situacao: 'CONTRA_ATAQUE' })]), CASA);
  assert.equal(rel.corrigir.find((p) => p.codigo === 'contra_ataque_sofrido').detalhe, 'O adversário marcou 3 golos em contra-ataque.');
  assert.equal(rel.manter.find((p) => p.codigo === 'contra_ataque_nosso').detalhe, '3 golos em 4 contra-ataques.');
});

// ------------------------- Regras: guarda-redes, defesa deles, disciplina -------------------------

test('o nosso guarda-redes em dificuldades pede troca; em forma, é para manter', () => {
  const mal = todos(estado([...varios(2, FORA, 'DEFESA'), ...varios(9, FORA, 'GOLO')]), CASA);
  const ponto = mal.corrigir.find((p) => p.codigo === 'gr_nosso_fraco');
  assert.equal(ponto.titulo, 'Considerar trocar o guarda-redes');
  assert.equal(ponto.detalhe, '#1 Rui Mesquita: 2 defesas em 11 remates à baliza (18%).');
  const bem = todos(estado([...varios(7, FORA, 'DEFESA'), ...varios(7, FORA, 'GOLO')]), CASA);
  assert.equal(bem.manter.find((p) => p.codigo === 'gr_nosso_bom').detalhe, '#1 Rui Mesquita: 7 defesas em 14 remates à baliza (50%).');
});

test('o guarda-redes deles em forma é para contornar, e diz onde defende', () => {
  const nossos = [...varios(3, CASA, 'DEFESA', { balizaZona: 'ALTO_ESQ' }), ...varios(2, CASA, 'DEFESA', { balizaZona: 'MEIO_DIR' }), ...varios(4, CASA, 'GOLO')];
  const ponto = todos(estado(nossos), CASA).corrigir.find((p) => p.codigo === 'gr_deles_quente');
  assert.equal(ponto.titulo, 'Variar os remates contra o guarda-redes #16 Nuno Viana');
  assert.equal(ponto.detalhe, '#16 Nuno Viana: 5 defesas em 9 remates à baliza (56%). Defende sobretudo alto à esquerda (3 de 5).');
  const cede = todos(estado([...varios(2, CASA, 'DEFESA'), ...varios(9, CASA, 'GOLO')]), CASA);
  assert.equal(cede.manter.find((p) => p.codigo === 'gr_deles_fraco').titulo, 'O guarda-redes deles está a ceder');
  const poucos = todos(estado([...varios(4, CASA, 'DEFESA'), ...varios(1, CASA, 'GOLO')]), CASA);
  assert.ok(!codigos(poucos.corrigir).includes('gr_deles_quente'), 'com 5 remates à baliza ainda é cedo');
});

test('a defesa que o adversário joga, quando foi marcada', () => {
  const remates = [...varios(1, CASA, 'GOLO', { sistemaDefensivo: '6_0' }), ...varios(5, CASA, 'FORA', { sistemaDefensivo: '6_0' }),
    ...varios(4, CASA, 'GOLO', { sistemaDefensivo: '5_1' }), remate(CASA, 'FORA', { sistemaDefensivo: '5_1' }),
    remate(CASA, 'GOLO', { situacao: 'CONTRA_ATAQUE' })];
  const rel = todos(estado(remates), CASA);
  const ponto = rel.corrigir.find((p) => p.codigo === 'sistema_dificil');
  assert.equal(ponto.titulo, 'Atacar melhor a defesa 6:0');
  assert.equal(ponto.detalhe, '1 golo em 6 remates (17%) contra a defesa 6:0. Contra a 5:1: 4 em 5.');
  assert.equal(rel.manter.find((p) => p.codigo === 'sistema_facil').titulo, 'Bom contra a defesa 5:1');
  const semMarcar = todos(estado(base()), CASA);
  assert.ok(!codigos([...semMarcar.corrigir, ...semMarcar.manter]).some((c) => c.startsWith('sistema')));
});

test('um jogador com duas exclusões está em risco e passa à frente de tudo', () => {
  const sancoes = [{ jogadorId: 105, equipaId: CASA, numero: 5, nome: 'Diogo Pires', doisMinutos: 2, vermelhos: 0, expulso: false },
    { jogadorId: 107, equipaId: CASA, numero: 7, nome: 'Rui Costa', doisMinutos: 3, vermelhos: 0, expulso: true },   // já expulso: não se avisa
    { jogadorId: 211, equipaId: FORA, numero: 11, nome: 'Bruno Lopes', doisMinutos: 2, vermelhos: 0, expulso: false }];   // do adversário: não é nosso
  const rel = todos(estado([...varios(3, CASA, 'GOLO'), ...varios(7, CASA, 'FORA')], { sancoes }), CASA);
  assert.equal(rel.corrigir[0].codigo, 'risco_expulsao');
  assert.equal(rel.corrigir[0].titulo, 'Cuidado com o #5 Diogo Pires');
  assert.equal(rel.corrigir[0].detalhe, 'Já tem 2 exclusões de 2 minutos: à terceira fica desqualificado.');
  assert.equal(rel.corrigir.filter((p) => p.codigo === 'risco_expulsao').length, 1);
});

test('mais exclusões do que o adversário pedem disciplina', () => {
  const rel = todos(estado(base(), { outrosEventosPorParte: [outro(CASA, 'DOIS_MINUTOS', 3), outro(FORA, 'DOIS_MINUTOS', 1)] }), CASA);
  assert.equal(rel.corrigir.find((p) => p.codigo === 'exclusoes_nossas').detalhe, '3 exclusões de 2 minutos (adversário: 1).');
  const igual = todos(estado(base(), { outrosEventosPorParte: [outro(CASA, 'DOIS_MINUTOS', 2), outro(FORA, 'DOIS_MINUTOS', 2)] }), CASA);
  assert.ok(!codigos(igual.corrigir).includes('exclusoes_nossas'));
});

// ------------------------- Escolha dos pontos -------------------------

test('ficam só os 3 pontos a corrigir mais graves, e os 2 a manter melhores', () => {
  const sancoes = [{ jogadorId: 105, equipaId: CASA, numero: 5, nome: 'Diogo Pires', doisMinutos: 2, vermelhos: 0, expulso: false }];
  const remates = [...varios(2, CASA, 'GOLO'), ...varios(8, CASA, 'FORA'),                    // finalização fraca e o #7 a falhar
    ...varios(2, FORA, 'DEFESA'), ...varios(9, FORA, 'GOLO', { j: 11, situacao: 'CONTRA_ATAQUE' })];   // GR em apuros, o #11 a marcar tudo
  const extra = { sancoes, outrosEventosPorParte: [outro(CASA, 'PERDA_BOLA', 8), outro(FORA, 'PERDA_BOLA', 1)] };
  const rel = relatorioIntervalo(estado(remates, extra), CASA);
  assert.equal(PONTOS_A_CORRIGIR, 3);
  assert.equal(PONTOS_A_MANTER, 2);
  assert.deepEqual(codigos(rel.corrigir), ['risco_expulsao', 'jogador_perigoso', 'jogador_a_falhar'], 'os mais graves primeiro');
  const pesos = rel.corrigir.map((p) => p.peso);
  assert.deepEqual(pesos, [...pesos].sort((a, b) => b - a));
  // sem o limite há mais pontos: ficaram de fora os menos graves
  const completo = todos(estado(remates, extra));
  assert.ok(completo.corrigir.length > 3);
  assert.deepEqual(codigos(completo.corrigir).slice(0, 3), codigos(rel.corrigir));
  for (const ficouDeFora of ['gr_nosso_fraco', 'perdas_nossas', 'finalizacao_fraca']) assert.ok(codigos(completo.corrigir).includes(ficouDeFora), ficouDeFora);
});

test('só os 2 melhores pontos a manter ficam', () => {
  const remates = [...varios(8, CASA, 'GOLO', { j: 9 }), ...varios(2, CASA, 'FORA', { j: 9 })];
  const extra = { outrosEventosPorParte: [outro(CASA, 'PERDA_BOLA', 2), outro(FORA, 'PERDA_BOLA', 7)] };
  const rel = relatorioIntervalo(estado(remates, extra), CASA);
  assert.deepEqual(codigos(rel.manter), ['jogador_a_marcar', 'gr_deles_fraco']);
  assert.deepEqual(codigos(todos(estado(remates, extra)).manter).sort(), ['finalizacao_boa', 'gr_deles_fraco', 'jogador_a_marcar', 'perdas_deles']);
});

test('sem nada de especial não há pontos a corrigir', () => {
  const rel = relatorioIntervalo(estado(base()), CASA);
  assert.deepEqual(rel.corrigir, []);
  assert.deepEqual(rel.manter, []);
});

// ------------------------- Texto para copiar -------------------------

test('o texto para copiar tem o resultado, os pontos e os números', () => {
  const rel = relatorioIntervalo(estado(base(), { outrosEventosPorParte: [outro(CASA, 'PERDA_BOLA', 7), outro(FORA, 'PERDA_BOLA', 3)] }), CASA);
  const texto = textoRelatorio(rel);
  const linhas = texto.split('\n');
  assert.equal(linhas[0], 'Intervalo · Águias 4–4 Leões');
  assert.equal(linhas[1], 'Relatório da 1.ª parte, para Águias');
  assert.ok(linhas.includes('A corrigir na 2.ª parte:'));
  assert.ok(linhas.includes('1. Cuidar da bola: 7 perdas de bola (adversário: 3).'));
  assert.ok(linhas.includes('Números (Águias – Leões):'));
  assert.ok(linhas.includes('Golos: 4 – 4'));
  assert.ok(linhas.includes('Perdas de bola: 7 – 3'));
  const segunda = textoRelatorio(relatorioIntervalo(estado([...base(), remate(CASA, 'GOLO', { parte: 2 })]), CASA, 2)).split('\n');
  assert.equal(segunda[0], '2.ª parte · Águias 1–0 Leões');
  assert.ok(segunda.includes('A corrigir daqui para a frente:'));
  const vazio = textoRelatorio(relatorioIntervalo(estado(base().slice(0, 4)), CASA));
  assert.match(vazio, /\(Só 4 remates registados nesta parte: os pontos podem enganar\.\)/);
  assert.match(vazio, /Ainda não há remates que cheguem para apontar pontos\./);
});

test('as frases do aviso e de «nada a corrigir» dependem de haver remates que cheguem', () => {
  const um = relatorioIntervalo(estado([remate(CASA, 'GOLO')]), CASA);
  assert.equal(avisoPoucosDados(um), 'Só 1 remate registado nesta parte: os pontos podem enganar.');
  assert.equal(avisoPoucosDados(relatorioIntervalo(estado([]), CASA)), 'Ainda sem remates registados nesta parte.');
  const completo = relatorioIntervalo(estado(base()), CASA);
  assert.equal(avisoPoucosDados(completo), null);
  assert.equal(semPontosACorrigir(completo), 'Nada de grave nos números. Continuar assim.');
  assert.equal(semPontosACorrigir(um), 'Ainda não há remates que cheguem para apontar pontos.');
});
