// Testes do relatório do próximo adversário (frontend/js/relatorio-adversario.js): os números por jogo e as regras
// que escolhem o que explorar e o que travar.
//   node --no-warnings --test unidade/
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  relatorioAdversario, textoRelatorio, avisoPoucosDados, semPontos, descricaoDosJogos, linhasPorSistema,
  PONTOS_A_EXPLORAR, PONTOS_A_TRAVAR, MINIMO_REMATES,
} from '../../frontend/js/relatorio-adversario.js';

const X = 10;          // a equipa de quem se faz o relatório (o adversário)
const NOS = 1;         // a equipa da conta
const OUTRA = 3;       // uma terceira equipa
const GR_X = 200;      // guarda-redes da equipa X (defende os remates dos adversários)
const GR_NOS = 100;

const jogadores = [
  { id: 1007, equipaId: X, numero: 7, nome: 'Rui Costa', posicao: 'LE' },
  { id: 1009, equipaId: X, numero: 9, nome: 'Miguel Sousa', posicao: 'PI' },
  { id: 1011, equipaId: X, numero: 11, nome: 'Bruno Lopes', posicao: 'PD' },
  { id: GR_X, equipaId: X, numero: 1, nome: 'Nuno Viana', posicao: 'GR' },
  { id: 1099, equipaId: X, numero: 99, nome: 'Outro GR', posicao: 'GR' },
];
const idDe = { 7: 1007, 9: 1009, 11: 1011 };

const jogo = (jogoId, adversarioId, golos, golosAdversario, dia) => ({
  jogoId, dataHora: `2026-0${dia}-10T18:00:00Z`, adversarioId, adversarioNome: adversarioId === NOS ? 'Águias' : 'Falcões',
  emCasa: true, golos, golosAdversario,
});
// Dois jogos: o 1 contra nós (vitória), o 2 contra a terceira equipa (derrota)
const JOGOS = [jogo(1, NOS, 24, 20, 3), jogo(2, OUTRA, 18, 22, 4)];

/** Um remate da equipa X (j = número do jogador) ou do adversário (equipaId diferente). */
const remate = (equipaId, resultado, { j = 7, jogoId = 1, ...extra } = {}) => ({
  jogoId, equipaId, jogadorId: equipaId === X ? idDe[j] ?? 1000 + j : 500 + j, jogadorNumero: j, resultado, situacao: 'POSICIONAL', parte: 1,
  corredor: null, distancia: null, guardaRedesId: equipaId === X ? GR_NOS : GR_X,
  balizaX: null, balizaY: null, balizaZona: null, sistemaDefensivo: null, ...extra,
});
const varios = (n, equipaId, resultado, extra) => Array.from({ length: n }, () => remate(equipaId, resultado, extra));
/** n remates da lista de resultados, repetidos: ['GOLO', 4] = 4 golos. */
const sequencia = (equipaId, partes, extra) => partes.flatMap(([resultado, n]) => varios(n, equipaId, resultado, extra));
const outro = (tipo, total, jogoId = 1, equipaId = X) => ({ jogoId, equipaId, tipo, total });

const dados = (remates = [], extra = {}) => ({ equipaId: X, nome: 'Leões', jogos: JOGOS, jogadores, remates, outrosEventos: [], ...extra });
/** O relatório com todos os pontos que as regras propõem, para cada regra se testar sozinha. */
const todos = (d, opcoes = {}) => relatorioAdversario(d, { ...opcoes, limites: { explorar: 99, travar: 99 } });
const codigos = (lista) => lista.map((p) => p.codigo);

// ------------------------- Números -------------------------

test('sem jogos registados não há números nem pontos', () => {
  const rel = relatorioAdversario(dados([], { jogos: [] }));
  assert.equal(rel.nJogos, 0);
  assert.deepEqual(rel.numeros, []);
  assert.deepEqual(rel.explorar, []);
  assert.deepEqual(rel.travar, []);
  assert.ok(rel.poucosDados);
  assert.equal(avisoPoucosDados(rel), null, 'sem jogos não há aviso de poucos dados: há o estado vazio');
  assert.equal(semPontos(rel, 'explorar'), 'Ainda não há jogos registados desta equipa.');
  assert.equal(descricaoDosJogos(rel), 'Sem jogos registados.');
});

test('os números por jogo somam os jogos, os golos e os remates da equipa', () => {
  const remates = [
    ...sequencia(X, [['GOLO', 6], ['DEFESA', 2], ['FORA', 2]], { jogoId: 1 }),
    ...sequencia(X, [['GOLO', 4], ['DEFESA', 4]], { jogoId: 2 }),
    ...sequencia(NOS, [['GOLO', 5], ['DEFESA', 3]], { jogoId: 1 }),
  ];
  const rel = relatorioAdversario(dados(remates, { outrosEventos: [outro('PERDA_BOLA', 8, 1), outro('PERDA_BOLA', 6, 2), outro('DOIS_MINUTOS', 3, 1)] }));
  const valor = (rotulo) => rel.numeros.find((n) => n.rotulo === rotulo)?.valor;
  assert.equal(rel.nJogos, 2);
  assert.equal(valor('Jogos (vitórias-empates-derrotas)'), '2 (1-0-1)');
  assert.equal(valor('Golos marcados por jogo'), '21,0');     // (24 + 18) / 2
  assert.equal(valor('Golos sofridos por jogo'), '21,0');     // (20 + 22) / 2
  assert.equal(valor('Remates por jogo'), '9,0');             // 18 remates em 2 jogos
  assert.equal(valor('Eficácia de remate'), '56%');           // 10 golos em 18
  assert.equal(valor('Eficácia dos adversários contra eles'), '63%');   // 5 golos em 8
  assert.equal(valor('Defesas dos guarda-redes'), '3 em 8 (38%)');
  assert.equal(valor('Perdas de bola por jogo'), '7,0');
  assert.equal(valor('Exclusões de 2 minutos por jogo'), '1,5');
  assert.equal(rel.remates, 18);
  assert.deepEqual(rel.golos, { marcados: 42, sofridos: 42 });
});

test('os jogos vêm do mais antigo para o mais recente e com o resultado de cada um', () => {
  const rel = relatorioAdversario(dados([], { jogos: [jogo(2, OUTRA, 18, 22, 4), jogo(1, NOS, 24, 20, 3), jogo(3, NOS, 20, 20, 5)] }));
  assert.deepEqual(rel.jogos.map((j) => [j.jogoId, j.resultado]), [[1, 'V'], [2, 'D'], [3, 'E']]);
});

test('contra a minha equipa conta só os jogos contra ela', () => {
  const remates = [...sequencia(X, [['GOLO', 5], ['DEFESA', 5]], { jogoId: 1 }), ...sequencia(X, [['GOLO', 9], ['DEFESA', 1]], { jogoId: 2 })];
  const todosJogos = relatorioAdversario(dados(remates));
  const contraNos = relatorioAdversario(dados(remates), { contraEquipaId: NOS });
  assert.equal(todosJogos.nJogos, 2);
  assert.equal(todosJogos.totalJogos, 2);
  assert.equal(contraNos.nJogos, 1);
  assert.equal(contraNos.totalJogos, 2);
  assert.equal(contraNos.remates, 10, 'os remates do jogo 2 não entram');
  assert.equal(descricaoDosJogos(contraNos, 'Águias'), 'Baseado em 1 jogo contra Águias.');
  assert.equal(descricaoDosJogos(todosJogos, 'Águias'), 'Baseado em 2 jogos registados (1 contra Águias).');
});

test('remates de jogos que não estão na lista (sem registos) não contam', () => {
  const rel = relatorioAdversario(dados(varios(30, X, 'GOLO', { jogoId: 99 })));
  assert.equal(rel.remates, 0);
  assert.deepEqual(rel.jogadores, []);
});

test('poucos remates avisam que os pontos podem enganar', () => {
  const pouco = relatorioAdversario(dados(varios(MINIMO_REMATES - 1, X, 'GOLO')));
  assert.ok(pouco.poucosDados);
  assert.match(avisoPoucosDados(pouco), /Só 19 remates registados em 2 jogos/);
  assert.equal(semPontos(pouco, 'explorar'), 'Ainda não há remates que cheguem para apontar pontos.');
  const chega = relatorioAdversario(dados(varios(MINIMO_REMATES, X, 'GOLO')));
  assert.equal(chega.poucosDados, false);
  assert.equal(avisoPoucosDados(chega), null);
  assert.equal(semPontos(chega, 'explorar'), 'Nenhuma fraqueza clara nos números.');
  assert.equal(semPontos(chega, 'travar'), 'Nenhum ponto forte que se destaque.');
});

// ------------------------- A explorar -------------------------

test('guarda-redes fraco: poucas defesas e a zona onde mais cede', () => {
  const remates = [
    ...varios(6, NOS, 'GOLO', { balizaZona: 'ALTO_ESQ' }), ...varios(2, NOS, 'GOLO', { balizaZona: 'MEIO_DIR' }),
    ...varios(2, NOS, 'DEFESA', { balizaZona: 'MEIO_CENTRO' }),
  ];
  const rel = todos(dados(remates));
  const ponto = rel.explorar.find((p) => p.codigo === 'gr_fraco');
  assert.ok(ponto, 'o guarda-redes defendeu 2 de 10 (20%)');
  assert.match(ponto.titulo, /#1 Nuno Viana/);
  assert.match(ponto.detalhe, /2 defesas em 10 remates à baliza \(20%\)/);
  assert.match(ponto.detalhe, /alto à esquerda \(6 de 8 golos\)/);
});

test('guarda-redes fraco precisa de remates à baliza que cheguem e de uma percentagem baixa', () => {
  assert.ok(!codigos(todos(dados([...varios(7, NOS, 'GOLO'), ...varios(0, NOS, 'DEFESA')])).explorar).includes('gr_fraco'), 'só 7 remates à baliza');
  assert.ok(!codigos(todos(dados([...varios(6, NOS, 'GOLO'), ...varios(4, NOS, 'DEFESA')])).explorar).includes('gr_fraco'), '40% não é fraco');
});

test('guarda-redes sem identificação: conta os da equipa toda', () => {
  const remates = [...varios(9, NOS, 'GOLO', { guardaRedesId: null }), ...varios(1, NOS, 'DEFESA', { guardaRedesId: null })];
  const ponto = todos(dados(remates)).explorar.find((p) => p.codigo === 'gr_fraco');
  assert.ok(ponto);
  assert.match(ponto.titulo, /os guarda-redes cedem/);
});

test('a defesa que jogam e que mais cede', () => {
  const remates = [...varios(7, NOS, 'GOLO', { sistemaDefensivo: '5_1' }), ...varios(3, NOS, 'DEFESA', { sistemaDefensivo: '5_1' })];
  const ponto = todos(dados(remates)).explorar.find((p) => p.codigo === 'defesa_cede');
  assert.ok(ponto);
  assert.equal(ponto.titulo, 'A defesa 5:1 deles cede');
  assert.match(ponto.detalhe, /7 golos em 10 remates \(70%\)/);
  const menos = [...varios(6, NOS, 'GOLO', { sistemaDefensivo: '5_1' }), ...varios(4, NOS, 'DEFESA', { sistemaDefensivo: '5_1' })];
  assert.ok(!codigos(todos(dados(menos)).explorar).includes('defesa_cede'), '60% está abaixo do limiar');
  const poucos = varios(7, NOS, 'GOLO', { sistemaDefensivo: '5_1' });
  assert.ok(!codigos(todos(dados(poucos)).explorar).includes('defesa_cede'), '7 remates são poucos');
});

test('só o ataque posicional conta para a defesa jogada', () => {
  const remates = varios(10, NOS, 'GOLO', { sistemaDefensivo: '5_1', situacao: 'CONTRA_ATAQUE' });
  assert.ok(!codigos(todos(dados(remates)).explorar).includes('defesa_cede'));
  assert.deepEqual(linhasPorSistema(remates), []);
});

test('o corredor por onde lhes marcam mais', () => {
  const remates = [...varios(5, NOS, 'GOLO', { corredor: 'LATERAL_ESQ' }), ...varios(5, NOS, 'GOLO', { corredor: 'CENTRAL' }), ...varios(4, NOS, 'GOLO', { corredor: 'PONTA_DIR' })];
  const ponto = todos(dados(remates)).explorar.find((p) => p.codigo === 'corredor_cede');
  assert.ok(ponto);
  assert.equal(ponto.titulo, 'Atacar pelo lateral esquerdo');
  assert.match(ponto.detalhe, /5 dos 14 golos que sofrem vêm do lateral esquerdo/);
  const dividido = [...varios(3, NOS, 'GOLO', { corredor: 'LATERAL_ESQ' }), ...varios(3, NOS, 'GOLO', { corredor: 'CENTRAL' }), ...varios(3, NOS, 'GOLO', { corredor: 'PONTA_DIR' })];
  assert.ok(!codigos(todos(dados(dividido)).explorar).includes('corredor_cede'));
});

test('a defesa contra a qual atacam mal pede essa defesa, e diz a alternativa em que marcam', () => {
  const remates = [
    ...sequencia(X, [['GOLO', 2], ['DEFESA', 6]], { sistemaDefensivo: '6_0' }),
    ...sequencia(X, [['GOLO', 4], ['DEFESA', 2]], { sistemaDefensivo: '5_1' }),
  ];
  const ponto = todos(dados(remates)).explorar.find((p) => p.codigo === 'ataque_contra_defesa');
  assert.ok(ponto);
  assert.equal(ponto.titulo, 'Defender em 6:0');
  assert.match(ponto.detalhe, /só marcam 2 em 8 remates \(25%\)/);
  assert.match(ponto.detalhe, /Contra a 5:1: 4 em 6/);
});

test('muitas perdas de bola e muitas exclusões', () => {
  const rel = todos(dados([], { outrosEventos: [outro('PERDA_BOLA', 12, 1), outro('PERDA_BOLA', 10, 2), outro('DOIS_MINUTOS', 4, 1), outro('DOIS_MINUTOS', 3, 2)] }));
  const perdas = rel.explorar.find((p) => p.codigo === 'perdas');
  assert.equal(perdas.titulo, 'Pressionar a saída de bola');
  assert.match(perdas.detalhe, /22 perdas de bola em 2 jogos \(11,0 por jogo\)/);
  const exclusoes = rel.explorar.find((p) => p.codigo === 'exclusoes');
  assert.match(exclusoes.detalhe, /7 exclusões de 2 minutos em 2 jogos \(3,5 por jogo\)/);
});

test('as perdas e exclusões dos adversários não contam', () => {
  const rel = todos(dados([], { outrosEventos: [outro('PERDA_BOLA', 40, 1, NOS), outro('DOIS_MINUTOS', 20, 1, NOS)] }));
  assert.deepEqual(rel.explorar, []);
});

test('finalização fraca precisa de remates que cheguem', () => {
  const fraca = sequencia(X, [['GOLO', 12], ['DEFESA', 12], ['FORA', 6]]);
  assert.ok(codigos(todos(dados(fraca)).explorar).includes('finalizacao_fraca'), '12 em 30 = 40%');
  const poucos = sequencia(X, [['GOLO', 5], ['DEFESA', 15]]);
  assert.ok(!codigos(todos(dados(poucos)).explorar).includes('finalizacao_fraca'), '20 remates são poucos para esta regra');
});

test('um lançador de 7 metros que falha', () => {
  const remates = [...varios(1, X, 'GOLO', { j: 9, situacao: 'SETE_METROS' }), ...varios(2, X, 'DEFESA', { j: 9, situacao: 'SETE_METROS' }), ...varios(1, X, 'FORA', { j: 9, situacao: 'SETE_METROS' })];
  const ponto = todos(dados(remates)).explorar.find((p) => p.codigo === 'sete_metros_fraco');
  assert.ok(ponto);
  assert.equal(ponto.titulo, '#9 Miguel Sousa falha os 7 metros');
  assert.match(ponto.detalhe, /1 golos em 4 lançamentos \(2 defendidos\)/);
});

// ------------------------- A travar -------------------------

test('o jogador que marca uma parte grande dos golos', () => {
  const remates = [...sequencia(X, [['GOLO', 8], ['DEFESA', 4]], { j: 7 }), ...sequencia(X, [['GOLO', 6], ['DEFESA', 2]], { j: 9 }), ...sequencia(X, [['GOLO', 6]], { j: 11 })];
  const rel = todos(dados(remates));
  const ponto = rel.travar.find((p) => p.codigo === 'jogador_perigoso');
  assert.ok(ponto);
  assert.equal(ponto.titulo, 'Marcar de perto o #7 Rui Costa');
  assert.match(ponto.detalhe, /8 dos 20 golos \(40%\), com 67% de eficácia em 12 remates/);
  assert.deepEqual(rel.jogadores.map((j) => j.numero), [7, 9, 11], 'do que mais marca para o que menos marca');
  assert.equal(rel.jogadores[0].nome, 'Rui Costa');
  assert.equal(rel.jogadores[0].jogos, 1);
});

test('sem golos que cheguem não se aponta nenhum jogador', () => {
  const remates = [...varios(5, X, 'GOLO', { j: 7 }), ...varios(5, X, 'GOLO', { j: 9 })];
  assert.ok(!codigos(todos(dados(remates)).travar).includes('jogador_perigoso'));
});

test('o corredor de onde marcam mais', () => {
  const remates = [...varios(6, X, 'GOLO', { corredor: 'PONTA_DIR' }), ...varios(6, X, 'GOLO', { corredor: 'CENTRAL' }), ...varios(3, X, 'GOLO', { corredor: 'LATERAL_ESQ' })];
  const ponto = todos(dados(remates)).travar.find((p) => p.codigo === 'corredor_forte');
  assert.ok(ponto);
  assert.match(ponto.titulo, /^Fechar a ponta direita|^Fechar o central/);
  assert.match(ponto.detalhe, /6 dos 15 golos vêm/);
});

test('golos em contra-ataque pedem recuperação rápida', () => {
  const ponto = todos(dados(varios(5, X, 'GOLO', { situacao: 'CONTRA_ATAQUE' }))).travar.find((p) => p.codigo === 'contra_ataque');
  assert.ok(ponto);
  assert.equal(ponto.titulo, 'Recuperar depressa');
  assert.match(ponto.detalhe, /5 golos em contra-ataque em 2 jogos \(2,5 por jogo\)/);
  assert.ok(!codigos(todos(dados(varios(4, X, 'GOLO', { situacao: 'CONTRA_ATAQUE' }))).travar).includes('contra_ataque'), '2 por jogo não chega');
});

test('guarda-redes forte: variar os remates e a zona que defende', () => {
  const remates = [...varios(7, NOS, 'DEFESA', { balizaZona: 'BAIXO_ESQ' }), ...varios(3, NOS, 'DEFESA', { balizaZona: 'MEIO_DIR' }), ...varios(3, NOS, 'GOLO')];
  const ponto = todos(dados(remates)).travar.find((p) => p.codigo === 'gr_forte');
  assert.ok(ponto);
  assert.match(ponto.titulo, /Variar os remates contra o #1 Nuno Viana/);
  assert.match(ponto.detalhe, /10 defesas em 13 remates à baliza \(77%\)/);
  assert.match(ponto.detalhe, /baixo à esquerda \(7 de 10\)/);
  const rel = todos(dados(remates));
  assert.equal(rel.guardaRedes[0].numero, 1);
  assert.equal(rel.guardaRedes[0].baliza, 13);
});

test('a zona da baliza para onde mais rematam, com remates com local que cheguem', () => {
  const remates = [...varios(6, X, 'GOLO', { balizaZona: 'MEIO_CENTRO' }), ...varios(3, X, 'DEFESA', { balizaZona: 'ALTO_DIR' }), ...varios(3, X, 'GOLO', { balizaZona: 'BAIXO_ESQ' })];
  const rel = todos(dados(remates));
  const ponto = rel.travar.find((p) => p.codigo === 'zona_preferida');
  assert.ok(ponto);
  assert.equal(ponto.titulo, 'Preparar o guarda-redes: meio ao centro');
  assert.match(ponto.detalhe, /6 dos 12 remates com local/);
  assert.deepEqual(rel.zonaDaBaliza, { zona: 'MEIO_CENTRO', total: 6, de: 12 });
  const poucos = [...varios(5, X, 'GOLO', { balizaZona: 'MEIO_CENTRO' }), ...varios(4, X, 'DEFESA', { balizaZona: 'ALTO_DIR' })];
  assert.equal(todos(dados(poucos)).zonaDaBaliza, null, 'menos de 10 remates com local');
});

test('um lançador de 7 metros seguro, com a zona para onde bate', () => {
  const remates = varios(4, X, 'GOLO', { j: 11, situacao: 'SETE_METROS', balizaX: 80, balizaY: 80, balizaZona: 'BAIXO_DIR' });
  const rel = todos(dados(remates));
  const ponto = rel.travar.find((p) => p.codigo === 'sete_metros_bom');
  assert.ok(ponto);
  assert.equal(ponto.titulo, '7 metros: #11 Bruno Lopes');
  assert.match(ponto.detalhe, /4 golos em 4 lançamentos/);
  assert.match(ponto.detalhe, /baixo à direita \(4 de 4\)/);
  assert.deepEqual(rel.seteMetros.total, { lancamentos: 4, golos: 4 });
});

test('7 metros sofridos: quantos lhes lançaram e quantos defenderam', () => {
  const rel = relatorioAdversario(dados([...varios(3, NOS, 'GOLO', { situacao: 'SETE_METROS' }), ...varios(2, NOS, 'DEFESA', { situacao: 'SETE_METROS' })]));
  assert.deepEqual(rel.seteMetros.sofridos, { lancamentos: 5, golos: 3, defendidos: 2 });
});

test('finalização forte e defesa sólida', () => {
  const remates = [...sequencia(X, [['GOLO', 22], ['DEFESA', 8]]), ...sequencia(NOS, [['GOLO', 8], ['DEFESA', 14], ['FORA', 8]])];
  const rel = todos(dados(remates));
  assert.ok(codigos(rel.travar).includes('finalizacao_boa'), '22 em 30 = 73%');
  const solida = rel.travar.find((p) => p.codigo === 'defesa_solida');
  assert.ok(solida, '8 em 30 = 27%');
  assert.match(solida.detalhe, /só marcam 8 em 30 remates \(27%\)/);
});

// ------------------------- Escolha e limites -------------------------

test('por omissão ficam 3 pontos a explorar e 3 a travar, dos de maior peso', () => {
  assert.equal(PONTOS_A_EXPLORAR, 3);
  assert.equal(PONTOS_A_TRAVAR, 3);
  const remates = [
    ...sequencia(NOS, [['GOLO', 7], ['DEFESA', 3]], { sistemaDefensivo: '5_1', corredor: 'LATERAL_ESQ' }),       // defesa_cede, corredor_cede, gr_fraco (3/10)
    ...sequencia(X, [['GOLO', 12], ['DEFESA', 12], ['FORA', 6]]),                                                  // finalizacao_fraca
    ...sequencia(X, [['GOLO', 5]], { situacao: 'CONTRA_ATAQUE' }),                                                 // contra_ataque
  ];
  const outros = [outro('PERDA_BOLA', 24, 1), outro('DOIS_MINUTOS', 8, 1)];
  const completo = todos(dados(remates, { outrosEventos: outros }));
  assert.ok(completo.explorar.length > 3, 'há mais pontos do que os que ficam');
  const normal = relatorioAdversario(dados(remates, { outrosEventos: outros }));
  assert.equal(normal.explorar.length, 3);
  assert.deepEqual(codigos(normal.explorar), codigos(completo.explorar).slice(0, 3), 'ficam os primeiros, por peso');
  const so1 = relatorioAdversario(dados(remates, { outrosEventos: outros }), { limites: { explorar: 1, travar: 1 } });
  assert.equal(so1.explorar.length, 1);
  assert.ok(so1.travar.length <= 1);
});

test('um ponto não leva o peso nem o tipo para fora', () => {
  const remates = sequencia(NOS, [['GOLO', 2], ['DEFESA', 8]]);
  const rel = todos(dados(remates));
  for (const p of [...rel.explorar, ...rel.travar]) assert.deepEqual(Object.keys(p).sort(), ['codigo', 'detalhe', 'titulo']);
});

test('um jogador que já não está no plantel aparece com o número do remate', () => {
  const rel = relatorioAdversario(dados(varios(3, X, 'GOLO', { j: 33 })));
  assert.equal(rel.jogadores[0].numero, 33);
  assert.equal(rel.jogadores[0].nome, '');
});

// ------------------------- Texto -------------------------

test('o texto para copiar tem os pontos, os números e quem marca', () => {
  const remates = [...sequencia(X, [['GOLO', 8], ['DEFESA', 4]], { j: 7 }), ...sequencia(X, [['GOLO', 6], ['DEFESA', 2]], { j: 9 }), ...sequencia(X, [['GOLO', 6]], { j: 11 }),
    ...varios(6, NOS, 'GOLO', { balizaZona: 'ALTO_ESQ' }), ...varios(2, NOS, 'DEFESA')];
  const rel = relatorioAdversario(dados(remates));
  const texto = textoRelatorio(rel, 'Águias');
  assert.match(texto, /^Relatório do adversário · Leões\nBaseado em 2 jogos registados \(1 contra Águias\)\./);
  assert.match(texto, /A explorar:\n1\. /);
  assert.match(texto, /A travar:\n1\. Marcar de perto o #7 Rui Costa/);
  assert.match(texto, /Números:\nJogos \(vitórias-empates-derrotas\): 2 \(1-0-1\)/);
  assert.match(texto, /Quem marca:\n#7 Rui Costa: 8 golos em 12 remates \(67%\)/);
  assert.doesNotMatch(texto, /undefined|NaN/);
});

test('o texto de uma equipa sem jogos diz que não há dados', () => {
  const texto = textoRelatorio(relatorioAdversario(dados([], { jogos: [] })));
  assert.match(texto, /Sem jogos registados\./);
  assert.match(texto, /Ainda não há jogos registados desta equipa\./);
  assert.doesNotMatch(texto, /Números:/);
});
