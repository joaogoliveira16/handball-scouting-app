// Testes das contas da página de administração (frontend/js/admin-calculos.js): pesquisa, filtros, números do topo
// e que ações se mostram para cada conta.
//   node --no-warnings --test unidade/
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acoesDaConta, acoesDoJogo, avisoDaAcao, avisoDaEdicao, avisoDoEmailDeTeste, avisoDoJogo, confirmacao, confirmacaoDoJogo, contarContas, corresponde,
  descreverEmail, descreverUltimoAcesso, emailConfere, erroDaEdicao, FILTROS_REGISTO, filtrarContas, filtrarJogos, filtrarRegisto, ligacaoDosEventos, nomeDoFicheiro, normalizar,
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
  assert.deepEqual(acoesDaConta(CONTAS[0], 1), { propria: true, repor: false, papel: null, ativa: null, eliminar: false, editar: false, exportar: false });
});

test('as ações de uma conta ativa: repor, tornar admin, desativar, eliminar', () => {
  assert.deepEqual(acoesDaConta(CONTAS[1], 1), { propria: false, repor: true, papel: 'admin', ativa: false, eliminar: true, editar: true, exportar: true });
});

test('as ações de um admin: tirar o papel em vez de o dar, e nunca eliminar', () => {
  const outroAdmin = conta(9, 'Outro Admin', { papel: 'admin' });
  assert.deepEqual(acoesDaConta(outroAdmin, 1), { propria: false, repor: true, papel: 'normal', ativa: false, eliminar: false, editar: false, exportar: true });
});

test('uma conta por confirmar não pode ser admin, mas pode receber a ligação e ser desativada', () => {
  assert.deepEqual(acoesDaConta(CONTAS[2], 1), { propria: false, repor: true, papel: null, ativa: false, eliminar: true, editar: true, exportar: true });
});

test('uma conta desativada só se volta a ativar ou elimina (sem repor a palavra-passe nem tornar admin)', () => {
  assert.deepEqual(acoesDaConta(CONTAS[3], 1), { propria: false, repor: false, papel: null, ativa: true, eliminar: true, editar: true, exportar: true });
  assert.deepEqual(acoesDaConta(CONTAS[4], 1), { propria: false, repor: false, papel: 'normal', ativa: true, eliminar: false, editar: false, exportar: true }, 'um admin desativado ainda pode perder o papel, mas só se elimina depois');
});

test('as frases de confirmação dizem a quem se faz o quê', () => {
  const c = CONTAS[1];
  for (const acao of ['repor', 'admin', 'normal', 'desativar', 'ativar', 'eliminar']) {
    const frase = confirmacao(acao, c);
    assert.ok(frase.includes(c.nome) && frase.includes(c.email), `${acao}: nome e email`);
    assert.match(avisoDaAcao(acao, c), /\.$/);
  }
  assert.match(confirmacao('desativar', c), /sessão termina/);
  assert.match(confirmacao('repor', c), /palavra-passe atual continua/);
  assert.match(confirmacao('eliminar', c), /não se pode desfazer/);
  assert.match(confirmacao('eliminar', c), /Desativar/, 'lembra a alternativa que não apaga nada');
  assert.match(confirmacao('eliminar', c), /escreve o email/);
  assert.match(confirmacao('eliminar', c), /cópia de segurança/, 'avisa que o browser guarda uma cópia antes de eliminar');
  assert.equal(confirmacao('outra', c), '');
});

test('eliminar só avança com o email da conta escrito (sem espaços nem maiúsculas a mais)', () => {
  const c = conta(7, 'Rui Pereira', { email: 'Rui.Pereira@Exemplo.pt' });
  assert.ok(emailConfere('rui.pereira@exemplo.pt', c));
  assert.ok(emailConfere('  RUI.PEREIRA@EXEMPLO.PT  ', c));
  assert.ok(!emailConfere('', c), 'vazio não serve');
  assert.ok(!emailConfere(null, c), 'cancelar não serve');
  assert.ok(!emailConfere('rui.pereira@exemplo.pt.mal', c));
  assert.ok(!emailConfere('rui', c));
  assert.ok(!emailConfere('', { email: '' }), 'uma conta sem email nunca coincide');
  assert.ok(!emailConfere('x', null));
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

const emailBase = { host: 'mailpit', porta: 1025, temUtilizador: false, usaSsl: false, de: 'scouting@localhost', urlPublico: 'http://localhost:8080', urlPublicoLocal: true };

test('a faixa dos emails diz se as pessoas recebem alguma coisa', () => {
  assert.equal(descreverEmail(null), null, 'sem estado não há faixa');

  const porConfigurar = descreverEmail({ ...emailBase, modo: 'nao_configurado', host: null });
  assert.equal(porConfigurar.nivel, 'aviso');
  assert.equal(porConfigurar.podeTestar, false, 'sem servidor não há para onde mandar o teste');
  assert.match(porConfigurar.detalhe, /EMAIL_HOST/);

  const teste = descreverEmail({ ...emailBase, modo: 'teste' });
  assert.equal(teste.nivel, 'aviso');
  assert.equal(teste.podeTestar, true);
  assert.match(teste.detalhe, /não chegam a ninguém/);
  assert.match(teste.detalhe, /localhost:8025/, 'diz onde está a caixa de teste');
  assert.match(teste.detalhe, /URL_PUBLICO/, 'e que as ligações apontam para localhost');
});

test('com um servidor a sério a faixa fica ok, salvo se as ligações dos emails apontarem para localhost', () => {
  const real = { ...emailBase, modo: 'real', host: 'smtp.gmail.com', de: 'eu@gmail.com', urlPublico: 'https://scouting.exemplo.pt', urlPublicoLocal: false };
  const ok = descreverEmail(real);
  assert.equal(ok.nivel, 'ok');
  assert.equal(ok.podeTestar, true);
  assert.match(ok.titulo, /smtp\.gmail\.com/);
  assert.match(ok.detalhe, /eu@gmail\.com/);
  assert.doesNotMatch(ok.detalhe, /URL_PUBLICO/);

  const comLocalhost = descreverEmail({ ...real, urlPublico: 'http://localhost:8080', urlPublicoLocal: true });
  assert.equal(comLocalhost.nivel, 'aviso');
  assert.match(comLocalhost.detalhe, /URL_PUBLICO/);
});

test('o aviso do email de teste diz onde o ir ver', () => {
  assert.match(avisoDoEmailDeTeste({ modo: 'teste' }, 'ana@exemplo.pt'), /ana@exemplo\.pt.*caixa de teste/);
  assert.match(avisoDoEmailDeTeste({ modo: 'real' }, 'ana@exemplo.pt'), /caixa de correio/);
  assert.match(avisoDoEmailDeTeste(null, 'ana@exemplo.pt'), /ana@exemplo\.pt/);
});

test('depois de eliminar o aviso diz onde ficou a cópia de segurança', () => {
  const c = CONTAS[1];
  assert.equal(avisoDaAcao('eliminar', c, 'conta-2-joao.json'), 'Conta de João Oliveira eliminada. Cópia de segurança guardada: conta-2-joao.json.');
  assert.equal(avisoDaAcao('eliminar', c), 'Conta de João Oliveira eliminada.');
});

test('editar uma conta: o que está mal no nome e no email escritos', () => {
  const c = CONTAS[1];
  assert.equal(erroDaEdicao({ nome: 'João Novo', email: c.email }, c), null);
  assert.equal(erroDaEdicao({ nome: c.nome, email: 'novo@exemplo.pt' }, c), null);
  assert.equal(erroDaEdicao({ nome: '  ', email: c.email }, c), 'Escreve o nome.');
  assert.match(erroDaEdicao({ nome: 'x'.repeat(81), email: c.email }, c), /80 caracteres/);
  assert.equal(erroDaEdicao({ nome: c.nome, email: '' }, c), 'Escreve o email.');
  assert.equal(erroDaEdicao({ nome: c.nome, email: 'sem-arroba' }, c), 'O email não é válido.');
  assert.equal(erroDaEdicao({ nome: c.nome, email: 'a@b' }, c), 'O email não é válido.');
  assert.equal(erroDaEdicao({ nome: c.nome, email: 'a b@exemplo.pt' }, c), 'O email não é válido.');
  assert.equal(erroDaEdicao({ nome: c.nome, email: `${'a'.repeat(160)}@exemplo.pt` }, c), 'O email não é válido.');
  assert.equal(erroDaEdicao({ nome: ` ${c.nome} `, email: c.email.toUpperCase() }, c), 'Não mudaste nada.', 'espaços e maiúsculas não contam como mudança');
});

test('o aviso da edição diz se o email mudou e se o email com a ligação saiu', () => {
  const c = CONTAS[1];
  assert.equal(avisoDaEdicao({ emailMudou: false, emailEnviado: false }, c, c.email), 'Conta de João Oliveira atualizada.');
  assert.equal(avisoDaEdicao(null, c, c.email), 'Conta de João Oliveira atualizada.');
  const enviado = avisoDaEdicao({ emailMudou: true, emailEnviado: true }, c, 'novo@exemplo.pt');
  assert.match(enviado, /novo@exemplo\.pt/);
  assert.match(enviado, /por confirmar/);
  assert.match(enviado, /enviámos-lhe a ligação/);
  const falhou = avisoDaEdicao({ emailMudou: true, emailEnviado: false }, c, 'novo@exemplo.pt');
  assert.match(falhou, /não saiu/);
  assert.match(falhou, /página de entrada/);
});

test('o nome do ficheiro vem do cabeçalho Content-Disposition', () => {
  assert.equal(nomeDoFicheiro("attachment; filename=conta-4-ana-20261029-1830.json; filename*=UTF-8''conta-4-ana-20261029-1830.json"), 'conta-4-ana-20261029-1830.json');
  assert.equal(nomeDoFicheiro('attachment; filename="jogo-1-a-vs-b.json"'), 'jogo-1-a-vs-b.json');
  assert.equal(nomeDoFicheiro('attachment; filename=jogo-1.json'), 'jogo-1.json');
  assert.equal(nomeDoFicheiro("attachment; filename*=UTF-8''jo%C3%A3o.json"), 'joão.json');
  assert.equal(nomeDoFicheiro("attachment; filename*=UTF-8''%E0%A4%A"), 'copia.json', 'um nome mal codificado cai para o padrão');
  assert.equal(nomeDoFicheiro(null), 'copia.json');
  assert.equal(nomeDoFicheiro('inline'), 'copia.json');
  assert.equal(nomeDoFicheiro(null, 'outro.json'), 'outro.json');
});

test('o último acesso diz-se em palavras', () => {
  const agora = new Date('2026-10-29T18:00:00Z');
  const antes = (ms) => new Date(agora.getTime() - ms).toISOString();
  const h = 3600 * 1000;
  assert.equal(descreverUltimoAcesso(null, agora), '–');
  assert.equal(descreverUltimoAcesso(undefined, agora), '–');
  assert.equal(descreverUltimoAcesso('não é uma data', agora), '–');
  assert.equal(descreverUltimoAcesso(antes(10 * 60 * 1000), agora), 'na última hora');
  assert.equal(descreverUltimoAcesso(antes(h), agora), 'há 1 h');
  assert.equal(descreverUltimoAcesso(antes(5.9 * h), agora), 'há 5 h');
  assert.equal(descreverUltimoAcesso(antes(23.9 * h), agora), 'há 23 h');
  assert.equal(descreverUltimoAcesso(antes(24 * h), agora), 'ontem');
  assert.equal(descreverUltimoAcesso(antes(47 * h), agora), 'ontem');
  assert.equal(descreverUltimoAcesso(antes(72 * h), agora), 'há 3 dias');
  assert.equal(descreverUltimoAcesso(antes(29 * 24 * h), agora), 'há 29 dias');
  assert.match(descreverUltimoAcesso(antes(60 * 24 * h), agora), /2026/, 'passado um mês mostra a data');
  assert.equal(descreverUltimoAcesso(new Date(agora.getTime() + h).toISOString(), agora), 'na última hora', 'um relógio adiantado não dá «há -1 h»');
});

test('as ações de um jogo: terminar ou reabrir conforme o estado, e só mexe nos que têm conta', () => {
  assert.deepEqual(acoesDoJogo({ donoId: 2, terminadoEm: null }), { exportar: true, terminar: true, reabrir: false, apagar: true });
  assert.deepEqual(acoesDoJogo({ donoId: 2, terminadoEm: '2026-10-01T10:00:00Z' }), { exportar: true, terminar: false, reabrir: true, apagar: true });
  assert.deepEqual(acoesDoJogo({ donoId: null, terminadoEm: null }), { exportar: true, terminar: false, reabrir: false, apagar: false }, 'um jogo antigo, sem conta, só se exporta');
  assert.deepEqual(acoesDoJogo(undefined), { exportar: true, terminar: false, reabrir: false, apagar: false });
});

test('as frases sobre um jogo dizem qual é e o que vai acontecer', () => {
  const j = jogo(5, 'Leões', 'Falcões', { golosCasa: 28, golosFora: 25, eventos: 31 });
  for (const acao of ['terminar', 'reabrir', 'apagar']) {
    const frase = confirmacaoDoJogo(acao, j);
    assert.ok(frase.includes('Leões 28 – 25 Falcões') && frase.includes('conta Ana Costa'), `${acao}: o jogo e a conta`);
    assert.match(avisoDoJogo(acao, j), /\.$/);
  }
  assert.match(confirmacaoDoJogo('apagar', j), /31 eventos/);
  assert.match(confirmacaoDoJogo('apagar', j), /não se pode desfazer/i);
  assert.match(confirmacaoDoJogo('apagar', j), /cópia de segurança/);
  assert.match(confirmacaoDoJogo('apagar', { ...j, eventos: 1 }), /, com 1 evento\?/);
  assert.match(confirmacaoDoJogo('apagar', { ...j, eventos: 0 }), /, sem eventos\?/);
  assert.equal(confirmacaoDoJogo('outra', j), '');
  assert.equal(avisoDoJogo('apagar', j, 'jogo-5.json'), 'Jogo Leões – Falcões apagado. Cópia de segurança guardada: jogo-5.json.');
  assert.equal(avisoDoJogo('exportar', j, 'jogo-5.json'), 'Cópia de segurança guardada: jogo-5.json.');
  assert.equal(avisoDoJogo('terminar', j), 'Jogo Leões – Falcões terminado.');
});

test('o registo tem um filtro para os jogos', () => {
  assert.deepEqual(FILTROS_REGISTO.map((f) => f.codigo), ['', 'evento', 'conta', 'jogo']);
});
