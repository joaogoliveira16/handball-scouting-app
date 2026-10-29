// Testes das contas da página de administração (frontend/js/admin-calculos.js): pesquisa, filtros, números do topo
// e que ações se mostram para cada conta.
//   node --no-warnings --test unidade/
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acoesDaConta, avisoDaAcao, confirmacao, contarContas, corresponde, filtrarContas, filtrarJogos, filtrarRegisto, ligacaoDosEventos, normalizar,
} from '../../frontend/js/admin-calculos.js';

const conta = (id, nome, extra = {}) => ({
  id, nome, email: `${nome.toLowerCase().replace(/\s+/g, '.')}@exemplo.pt`, papel: 'normal', estado: 'ativo', equipa: `${nome} FC`, jogos: 0, ...extra,
});
const CONTAS = [
  conta(1, 'Ana Costa', { papel: 'admin', jogos: 12 }),
  conta(2, 'João Oliveira', { jogos: 5, equipa: 'Águias do Norte' }),
  conta(3, 'Rui Pereira', { estado: 'por_confirmar', equipa: null }),
  conta(4, 'Marta Silva', { estado: 'desativado', jogos: 3 }),
  conta(5, 'Pedro Santos', { papel: 'admin', estado: 'desativado' }),
];

test('a pesquisa ignora maiúsculas e acentos', () => {
  assert.equal(normalizar('  João  '), 'joao');
  assert.equal(normalizar('Águias'), 'aguias');
  assert.equal(normalizar(null), '');
  assert.ok(corresponde('joao', ['João Oliveira']));
  assert.ok(corresponde('AGUIAS', [null, 'Águias do Norte']));
  assert.ok(!corresponde('benfica', ['João Oliveira', 'Águias do Norte']));
});

test('todas as palavras da pesquisa têm de aparecer, por qualquer ordem e em campos diferentes', () => {
  assert.ok(corresponde('oliveira joao', ['João Oliveira', 'joao@exemplo.pt']));
  assert.ok(corresponde('joao aguias', ['João Oliveira', 'Águias do Norte']));
  assert.ok(!corresponde('joao costa', ['João Oliveira', 'Águias do Norte']));
  assert.ok(corresponde('', ['qualquer coisa']), 'sem pesquisa mostra tudo');
  assert.ok(corresponde('   ', []), 'só espaços também');
});

test('os números do topo contam cada estado; os admins desativados não contam como admins', () => {
  assert.deepEqual(contarContas(CONTAS), { total: 5, ativas: 2, admins: 1, porConfirmar: 1, desativadas: 2 });
  assert.deepEqual(contarContas([]), { total: 0, ativas: 0, admins: 0, porConfirmar: 0, desativadas: 0 });
  assert.deepEqual(contarContas(null), { total: 0, ativas: 0, admins: 0, porConfirmar: 0, desativadas: 0 });
});

test('os filtros das contas deixam passar só o que dizem', () => {
  const ids = (filtro, texto = '') => filtrarContas(CONTAS, { filtro, texto }).map((c) => c.id);
  assert.deepEqual(ids('todas'), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids('ativas'), [1, 2]);
  assert.deepEqual(ids('admins'), [1, 5], 'o filtro de admins mostra o papel, mesmo numa conta desativada');
  assert.deepEqual(ids('por_confirmar'), [3]);
  assert.deepEqual(ids('desativadas'), [4, 5]);
  assert.deepEqual(ids('todas', 'joao'), [2]);
  assert.deepEqual(ids('todas', 'aguias'), [2], 'pela equipa');
  assert.deepEqual(ids('todas', 'exemplo.pt silva'), [4], 'pelo email e pelo nome');
  assert.deepEqual(ids('desativadas', 'santos'), [5]);
  assert.deepEqual(ids('ativas', 'silva'), [], 'o filtro e a pesquisa juntam-se');
});

test('ninguém mexe na própria conta', () => {
  assert.deepEqual(acoesDaConta(CONTAS[0], 1), { propria: true, repor: false, papel: null, ativa: null });
});

test('as ações de uma conta ativa: repor, tornar admin, desativar', () => {
  assert.deepEqual(acoesDaConta(CONTAS[1], 1), { propria: false, repor: true, papel: 'admin', ativa: false });
});

test('as ações de um admin: tirar o papel em vez de o dar', () => {
  const outroAdmin = conta(9, 'Outro Admin', { papel: 'admin' });
  assert.deepEqual(acoesDaConta(outroAdmin, 1), { propria: false, repor: true, papel: 'normal', ativa: false });
});

test('uma conta por confirmar não pode ser admin, mas pode receber a ligação e ser desativada', () => {
  assert.deepEqual(acoesDaConta(CONTAS[2], 1), { propria: false, repor: true, papel: null, ativa: false });
});

test('uma conta desativada só se volta a ativar (sem repor a palavra-passe nem tornar admin)', () => {
  assert.deepEqual(acoesDaConta(CONTAS[3], 1), { propria: false, repor: false, papel: null, ativa: true });
  assert.deepEqual(acoesDaConta(CONTAS[4], 1), { propria: false, repor: false, papel: 'normal', ativa: true }, 'um admin desativado ainda pode perder o papel');
});

test('as frases de confirmação dizem a quem se faz o quê', () => {
  const c = CONTAS[1];
  for (const acao of ['repor', 'admin', 'normal', 'desativar', 'ativar']) {
    const frase = confirmacao(acao, c);
    assert.ok(frase.includes(c.nome) && frase.includes(c.email), `${acao}: nome e email`);
    assert.match(avisoDaAcao(acao, c), /\.$/);
  }
  assert.match(confirmacao('desativar', c), /sessão termina/);
  assert.match(confirmacao('repor', c), /palavra-passe atual continua/);
  assert.equal(confirmacao('outra', c), '');
});

const jogo = (id, casa, fora, extra = {}) => ({
  id, casaNome: casa, foraNome: fora, donoNome: 'Ana Costa', local: null, terminadoEm: null, golosCasa: 0, golosFora: 0, eventos: 0, ...extra,
});
const JOGOS = [
  jogo(1, 'Águias do Norte', 'Leões', { terminadoEm: '2026-10-01T10:00:00Z', local: 'Pavilhão da Luz' }),
  jogo(2, 'Leões', 'Falcões', { donoNome: 'João Oliveira' }),
  jogo(3, 'Falcões', 'Águias do Norte', { donoNome: 'Marta Silva', terminadoEm: '2026-10-02T10:00:00Z' }),
];

test('os jogos filtram-se por estado e pesquisam-se por equipa, conta ou local', () => {
  const ids = (filtro, texto = '') => filtrarJogos(JOGOS, { filtro, texto }).map((j) => j.id);
  assert.deepEqual(ids('todos'), [1, 2, 3]);
  assert.deepEqual(ids('a_decorrer'), [2]);
  assert.deepEqual(ids('terminados'), [1, 3]);
  assert.deepEqual(ids('todos', 'aguias'), [1, 3]);
  assert.deepEqual(ids('todos', 'joao'), [2], 'pela conta dona');
  assert.deepEqual(ids('todos', 'luz'), [1], 'pelo local');
  assert.deepEqual(ids('terminados', 'falcoes'), [3]);
});

test('a ligação dos eventos abre o jogo no modo de administração', () => {
  assert.equal(ligacaoDosEventos(42), 'eventos.html?jogo=42&admin=1');
});

test('o registo pesquisa-se por quem, ação e detalhe', () => {
  const linhas = [
    { id: 1, autorNome: 'Ana Costa', acao: 'Conta desativada', detalhe: 'joao@exemplo.pt', tipo: 'conta' },
    { id: 2, autorNome: 'Ana Costa', acao: 'Evento corrigido', detalhe: 'Leões vs Falcões · resultado de Fora para Golo', tipo: 'evento' },
    { id: 3, autorNome: 'Sistema', acao: 'Papel alterado', detalhe: 'ana@exemplo.pt: Normal passou a Admin (configuração)', tipo: 'conta' },
  ];
  assert.deepEqual(filtrarRegisto(linhas).map((l) => l.id), [1, 2, 3]);
  assert.deepEqual(filtrarRegisto(linhas, 'sistema').map((l) => l.id), [3]);
  assert.deepEqual(filtrarRegisto(linhas, 'leoes golo').map((l) => l.id), [2]);
  assert.deepEqual(filtrarRegisto(linhas, 'ana desativada').map((l) => l.id), [1]);
  assert.deepEqual(filtrarRegisto(null, 'x'), []);
});
