// Testes de ponta a ponta: abre as páginas num Chromium a sério e usa-as como um utilizador,
// contra a API verdadeira e a base de dados PostgreSQL (com os dados de exemplo).
//
//   API_URL=http://localhost:5080 PGHOST=localhost PGUSER=scouting PGPASSWORD=scouting PGDATABASE=scouting \
//     node e2e/fluxos.mjs
//
// O script arranca um pequeno servidor (e2e/servidor.mjs) que serve o frontend e reencaminha /api e /hub
// para a API, como o nginx da imagem Docker. Assume uma base "virgem" (só os dados de db/init): a primeira conta
// que o teste cria pela página de entrada herda as equipas e os jogos de exemplo.
//
// Variáveis: API_URL (http://localhost:5080), E2E_DIR (./resultados, onde ficam capturas e Excel),
//            APP_URL (usar um servidor já a correr em vez de arrancar o próprio),
//            EMAIL_API (caixa de correio de teste, Mailpit: http://localhost:8025, onde chegam os emails de confirmação),
//            SIGNALR_FALSO (só para desenvolver estes testes sem a API: ficheiro JS que substitui a biblioteca SignalR).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import pg from 'pg';
import { esperarMensagens, lerMensagem, mensagensPara, ultimoToken } from '../correio.mjs';
import { iniciarServidor } from './servidor.mjs';

const API_URL = process.env.API_URL ?? 'http://localhost:5080';
const E2E_DIR = process.env.E2E_DIR ?? path.join(process.cwd(), 'resultados');
const SIGNALR_FALSO = process.env.SIGNALR_FALSO ? fs.readFileSync(process.env.SIGNALR_FALSO, 'utf8') : null;
fs.mkdirSync(E2E_DIR, { recursive: true });

pg.types.setTypeParser(20, Number); // bigint -> número
const bd = new pg.Pool(); // PGHOST, PGUSER, PGPASSWORD, PGDATABASE
const q = (sql, p = []) => bd.query(sql, p).then((r) => r.rows);

const servidor = process.env.APP_URL
  ? { url: process.env.APP_URL, fechar: async () => {} }
  : await iniciarServidor({ apiUrl: API_URL });

const browser = await chromium.launch();
// Cada contexto é um "browser" à parte, com os seus próprios cookies (sessões)
async function novoContexto() {
  const contexto = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'pt-PT', timezoneId: 'UTC', acceptDownloads: true });
  await contexto.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: servidor.url });
  if (SIGNALR_FALSO) await contexto.route('**/lib/signalr.min.js', (r) => r.fulfill({ contentType: 'text/javascript', body: SIGNALR_FALSO }));
  return contexto;
}
const ctx = await novoContexto();            // a conta principal (fica com a sessão iniciada)
const ctxVisitante = await novoContexto();   // quem só tem o link de partilha: nunca inicia sessão

const falhas = [];
const linhas = [];
function ok(condicao, mensagem) {
  const linha = `${condicao ? 'OK   ' : 'FALHA'} ${mensagem}`;
  linhas.push(linha);
  console.log(linha);
  if (!condicao) falhas.push(mensagem);
}
const errosPaginas = [];
// Abre uma página. Opções: contexto (outro "browser"), tolerar (estados HTTP que o browser regista na consola e
// são esperados, como o 409 dos nomes repetidos ou o 401 de quem ainda não entrou), rapida (não espera pelo fim
// da rede: para páginas que redirecionam sozinhas), relogio (relógio do browser controlável: page.clock).
const semAssentar = [];   // páginas cuja rede não ficou parada (diagnóstico: que pedidos ficaram abertos)
async function pagina(caminho, { contexto = ctx, tolerar = [], rapida = false, relogio = false } = {}) {
  const page = await contexto.newPage();
  if (relogio) await page.clock.install();
  const esperados = ['409', ...tolerar];
  const pendentes = new Set();
  const historico = [];
  const nomeDe = (r) => `${r.method()} ${r.url().replace(servidor.url, '')}`;
  page.on('request', (r) => { pendentes.add(r); historico.push(nomeDe(r)); });
  page.on('requestfinished', (r) => pendentes.delete(r));
  page.on('requestfailed', (r) => pendentes.delete(r));
  page.on('websocket', (w) => historico.push(`WS ${w.url().replace(servidor.url, '')}`));
  page.on('pageerror', (e) => errosPaginas.push(`${caminho}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !esperados.some((e) => m.text().includes(e))) errosPaginas.push(`${caminho}: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  await page.goto(servidor.url + caminho, { waitUntil: 'domcontentloaded' });
  if (!rapida) {
    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch {
      semAssentar.push(`${caminho} [abertos: ${[...pendentes].map(nomeDe).join(', ') || 'nenhum'}; pedidos: ${historico.slice(-10).join(', ')}]`);
    }
  }
  return page;
}
const caminhoDe = (page) => { const u = new URL(page.url()); return u.pathname + u.search; };
const captura = (page, nome) => page.screenshot({ path: path.join(E2E_DIR, `e2e-${nome}.png`), fullPage: true });
const texto = async (locator) => ((await locator.textContent()) ?? '').replace(/\s+/g, '');
const esperarPor = async (funcao, ms = 10000) => {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await funcao()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return funcao();
};
// Com a biblioteca SignalR substituída (só no desenvolvimento destes testes) é preciso empurrar o estado à mão
async function empurrar(page, jogoId, codigo = null) {
  if (!SIGNALR_FALSO) return;
  await page.evaluate(async ({ id, c }) => {
    window.__hub.EstatisticasAtualizadas(await (await fetch(`/api/jogos/${id}/estatisticas${c ? `?c=${c}` : ''}`)).json());
  }, { id: jogoId, c: codigo });
}

async function passo(nome, funcao) {
  console.log(`\n== ${nome}`);
  try {
    await funcao();
  } catch (erro) {
    ok(false, `${nome}: exceção inesperada: ${String(erro?.message ?? erro).split('\n').slice(0, 4).join(' | ')}`);
  }
}

const sufixo = Date.now().toString(36).slice(-5);
const [aguias] = await q("SELECT id FROM equipas WHERE nome = 'Águias do Norte'");
const [leoes] = await q("SELECT id FROM equipas WHERE nome = 'Leões do Sul'");

// ======================= Contas =======================
const emailPrincipal = `principal-${sufixo}@exemplo.pt`;
const nomePrincipal = `Principal ${sufixo}`;
const equipaPrincipal = `Principal FC ${sufixo}`;   // a equipa da conta principal, pedida ao criar a conta
const SENHA = 'palavra-passe-123';
let donoId; // id da conta principal (dona dos dados de exemplo)

async function registarPelaPagina(p, { nome, equipa = `${nome} FC`, email, senha }) {
  await p.click('#aba-registo');
  await p.fill('#registo-nome', nome);
  await p.fill('#registo-equipa', equipa);
  await p.fill('#registo-email', email);
  await p.fill('#registo-senha', senha);
  await p.click('#botao-registo');
}

/** Abre, num browser, o link do email de confirmação mais recente deste endereço e espera pela página «Email confirmado». */
async function abrirLinkDoEmail(email, { contexto = ctx, quantas = 1 } = {}) {
  const token = await ultimoToken(email, quantas);
  if (!token) throw new Error(`não chegou o email de confirmação para ${email}`);
  const v = await pagina(`/verificar.html?t=${token}`, { contexto });
  await v.waitForSelector('#confirmado:not([hidden])');
  return { v, token };
}

await passo('Contas: criar conta, confirmar o email, sair e entrar', async () => {
  // Sem sessão, as páginas levam à entrada e guardam para onde voltar
  let p = await pagina('/equipas.html', { tolerar: ['401', '403'], rapida: true, relogio: true });   // 401: ainda sem sessão; 403: entrar sem ter confirmado o email
  await p.waitForURL(/entrar\.html/);
  ok(new URL(p.url()).searchParams.get('voltar') === 'equipas.html', `sem sessão: /equipas.html leva à entrada e guarda para onde voltar (${caminhoDe(p)})`);
  ok((await p.locator('#form-entrar').isVisible()) && (await p.locator('#form-registo').isHidden()), 'entrar: começa no formulário de entrada');
  ok((await p.locator('#entrar-convidado').getAttribute('href')) === 'convidado.html', 'entrar: há uma ligação «Entrar como convidado»');
  await captura(p, 'entrar');

  await p.click('#aba-registo');
  ok((await p.locator('#form-registo').isVisible()) && (await p.getAttribute('#aba-registo', 'aria-selected')) === 'true', 'entrar: o separador "Criar conta" mostra o registo');
  await captura(p, 'registo');

  // Validações antes de enviar
  await p.fill('#registo-nome', nomePrincipal); await p.fill('#registo-email', emailPrincipal); await p.fill('#registo-senha', SENHA);
  await p.click('#botao-registo');
  ok((await p.locator('#erro-registo').textContent()).includes('nome da tua equipa'), 'registo: sem o nome da equipa é recusado com mensagem');
  await p.fill('#registo-equipa', equipaPrincipal); await p.fill('#registo-email', 'sem-arroba');
  await p.click('#botao-registo');
  ok((await p.locator('#erro-registo').textContent()).includes('email válido'), 'registo: email inválido recusado com mensagem');
  await p.fill('#registo-email', emailPrincipal); await p.fill('#registo-senha', 'curta');
  await p.click('#botao-registo');
  ok((await p.locator('#erro-registo').textContent()).includes('pelo menos 8'), 'registo: palavra-passe curta recusada com mensagem');
  await p.fill('#registo-senha', SENHA);
  await p.click('.campo-palavra-passe:has(#registo-senha) .ver-senha');
  ok((await p.getAttribute('#registo-senha', 'type')) === 'text', 'registo: "Mostrar" revela a palavra-passe');
  await p.click('.campo-palavra-passe:has(#registo-senha) .ver-senha');
  ok((await p.getAttribute('#registo-senha', 'type')) === 'password', 'registo: "Esconder" volta a escondê-la');

  // Criar a conta pede para confirmar o email: ainda não há sessão nem dados
  ok((await q('SELECT 1 FROM equipas WHERE dono_id IS NOT NULL')).length === 0, 'antes de haver contas, as equipas de exemplo não têm dono');
  await p.click('#botao-registo');
  await p.waitForSelector('#painel-confirmar:not([hidden])');
  ok((await p.locator('#titulo-caixa').textContent()) === 'Confirma o teu email' && (await p.locator('#texto-confirmar b').textContent()) === emailPrincipal,
    'registo: aparece «Confirma o teu email» com o endereço para onde seguiu o link');
  ok(await p.locator('#entrada').isHidden() && (await p.locator('#estado-confirmar').isHidden()), 'registo: o formulário dá lugar ao aviso (sem erros)');
  ok(!(await ctx.cookies()).some((c) => c.name === 'sessao'), 'registo: ainda não há sessão iniciada (falta confirmar o email)');
  const [pendente] = await q('SELECT id, nome, email_verificado_em FROM utilizadores WHERE email = $1', [emailPrincipal]);
  donoId = pendente?.id;
  ok(pendente && pendente.nome === nomePrincipal && pendente.email_verificado_em === null, 'base de dados: a conta nova fica por confirmar');
  ok((await q('SELECT 1 FROM equipas WHERE dono_id IS NULL')).length === 2 && (await q('SELECT 1 FROM equipas WHERE dono_id = $1', [donoId])).length === 1,
    'e ainda não adotou as equipas de exemplo: só tem a equipa que indicou ao registar-se');
  const [equipaDaConta] = await q('SELECT e.nome FROM utilizadores u JOIN equipas e ON e.id = u.equipa_id WHERE u.id = $1', [donoId]);
  ok(equipaDaConta?.nome === equipaPrincipal, 'base de dados: essa é a equipa da conta');
  await captura(p, 'confirmar-email');

  // O email chegou à caixa de correio de teste
  const [chegou] = await esperarMensagens(emailPrincipal, 1);
  const email1 = chegou ? await lerMensagem(chegou.ID) : null;
  ok(!!email1 && /Confirma/.test(email1.Subject) && email1.Text.includes(`Olá ${nomePrincipal},`), 'email: chegou o email de confirmação com o nome da pessoa', email1?.Subject);
  ok(/\/verificar\.html\?t=[0-9a-f]{64}/.test(email1?.Text ?? '') && /<a href="[^"]+\/verificar\.html\?t=[0-9a-f]{64}"/.test(email1?.HTML ?? ''), 'email: o link para confirmar vai no texto e no botão HTML');

  // "Reenviar email" espera uns segundos; passado esse tempo envia outro email
  ok((await p.locator('#reenviar').isDisabled()) && /Reenviar email \(\d+ s\)/.test(await p.locator('#reenviar').textContent()), 'confirmar: «Reenviar email» começa parado com uma contagem');
  await p.clock.runFor(31000);
  ok((await p.locator('#reenviar').isEnabled()) && (await p.locator('#reenviar').textContent()) === 'Reenviar email', 'confirmar: passados 30 segundos o botão fica disponível');
  await p.click('#reenviar');
  await p.waitForFunction(() => document.getElementById('estado-confirmar').textContent.includes('Enviámos outro email'));
  ok((await esperarMensagens(emailPrincipal, 2)).length === 2, 'confirmar: «Reenviar email» envia outro email');
  ok(await p.locator('#reenviar').isDisabled(), 'confirmar: depois de reenviar o botão pára outra vez');

  // Tentar entrar sem ter aberto o link: diz para confirmar e oferece outro email
  await p.click('#ja-confirmei');
  ok((await p.inputValue('#entrar-email')) === emailPrincipal && (await p.locator('#form-entrar').isVisible()), 'confirmar: «Já confirmei, entrar» leva ao formulário com o email preenchido');
  await p.fill('#entrar-senha', SENHA);
  await p.click('#botao-entrar');
  await p.waitForFunction(() => document.getElementById('erro-entrar').textContent.length > 0);
  ok((await p.locator('#erro-entrar').textContent()).includes('Confirma o teu email') && (await p.locator('#reenviar-entrar').isVisible()), 'entrar sem confirmar: mostra o aviso e «Reenviar email de confirmação»');
  ok(!(await ctx.cookies()).some((c) => c.name === 'sessao'), 'entrar sem confirmar: não há sessão');
  await captura(p, 'entrar-sem-confirmar');
  await p.click('#reenviar-entrar');
  await p.waitForSelector('#painel-confirmar:not([hidden])');
  ok((await esperarMensagens(emailPrincipal, 3)).length === 3, 'entrar sem confirmar: «Reenviar email de confirmação» envia outro email');

  // Abrir o link do email (noutro separador): confirma a conta
  const { v: paginaLink, token } = await abrirLinkDoEmail(emailPrincipal, { quantas: 3 });
  ok((await paginaLink.locator('#confirmado h1').textContent()) === 'Email confirmado', 'link do email: «Email confirmado»');
  ok(!new URL(paginaLink.url()).searchParams.has('t'), 'link do email: o código sai do endereço depois de usado');
  await captura(paginaLink, 'email-confirmado');
  ok((await paginaLink.locator('#ir-entrar').getAttribute('href')) === 'entrar.html?confirmado=1', 'link do email: o botão «Entrar» leva à entrada');
  const [confirmada] = await q('SELECT email_verificado_em FROM utilizadores WHERE id = $1', [donoId]);
  ok(confirmada?.email_verificado_em !== null, 'base de dados: a conta ficou confirmada');
  const hashes = (await q('SELECT token_hash FROM verificacoes_email WHERE utilizador_id = $1', [donoId])).map((l) => l.token_hash);
  ok(hashes.length === 3 && hashes.includes(crypto.createHash('sha256').update(token).digest('hex')) && !hashes.includes(token), 'base de dados: dos links só ficam os SHA-256 dos códigos');
  await paginaLink.close();

  // Abrir o mesmo link outra vez continua a dar «confirmado»; códigos errados mostram o motivo e oferecem um link novo
  const outraVez = await pagina(`/verificar.html?t=${token}`);
  await outraVez.waitForSelector('#confirmado:not([hidden])');
  ok(true, 'link do email: abrir o mesmo link outra vez continua a mostrar «Email confirmado»');
  await outraVez.close();
  const invalido = await pagina(`/verificar.html?t=${'f'.repeat(64)}`, { tolerar: ['400'] });
  await invalido.waitForSelector('#falhou:not([hidden])');
  ok((await invalido.locator('#erro-confirmar').textContent()).includes('inválido ou já expirou') && (await invalido.locator('#form-novo-link').isVisible()), 'link inválido: explica o que se passou e oferece um link novo');
  await captura(invalido, 'email-link-invalido');
  await invalido.fill('#novo-email', `ninguem-${sufixo}@exemplo.pt`);
  await invalido.click('#botao-novo-link');
  await invalido.waitForSelector('#ok-novo-link:not([hidden])');
  ok((await invalido.locator('#ok-novo-link').textContent()).includes('Se a conta existir'), 'link inválido: pedir um link novo responde sem revelar se a conta existe');
  ok((await mensagensPara(`ninguem-${sufixo}@exemplo.pt`)).length === 0, 'link inválido: para um email sem conta não segue nenhum email');
  await invalido.close();
  const semCodigo = await pagina('/verificar.html', { tolerar: ['400'] });
  await semCodigo.waitForSelector('#falhou:not([hidden])');
  ok((await semCodigo.locator('#erro-confirmar').textContent()).includes('Falta o código'), 'link sem código: explica o que falta');
  await semCodigo.close();

  // De volta ao separador original: entrar leva à página pedida (equipas.html), já com a sessão iniciada
  await p.click('#ja-confirmei');
  await p.fill('#entrar-senha', SENHA);
  await p.click('#botao-entrar');
  await p.waitForURL((u) => u.pathname === '/equipas.html');
  await p.waitForSelector('.item-equipa');
  ok(true, 'entrar: depois de confirmar, entrar leva de volta à página pedida');
  ok((await p.locator('#conta-menu .quem').textContent()).includes(nomePrincipal), 'menu: mostra o nome da conta');
  ok((await p.locator('#conta-menu .avatar').textContent()) === 'P', 'menu: avatar com a inicial do nome');

  // O que ficou na base de dados: hash PBKDF2, só o hash da sessão, dados de exemplo herdados na confirmação
  const [u] = await q('SELECT id, email, nome, palavra_passe_hash FROM utilizadores WHERE email = $1', [emailPrincipal]);
  ok(u && u.nome === nomePrincipal && /^pbkdf2-sha256\$600000\$/.test(u.palavra_passe_hash) && !u.palavra_passe_hash.includes(SENHA), 'base de dados: palavra-passe guardada só como hash PBKDF2');
  const galleta = (await ctx.cookies()).find((c) => c.name === 'sessao');
  ok(galleta?.httpOnly === true && galleta.sameSite === 'Lax' && /^[0-9a-f]{64}$/.test(galleta.value), 'cookie de sessão: HttpOnly, SameSite=Lax, 64 hexadecimais');
  const hashDaSessao = galleta ? crypto.createHash('sha256').update(galleta.value).digest('hex') : '';
  const sessoes = await q('SELECT token_hash FROM sessoes WHERE utilizador_id = $1', [donoId]);
  ok(sessoes.length === 1 && sessoes[0].token_hash === hashDaSessao, 'base de dados: da sessão só fica o SHA-256 do código do cookie');
  ok((await q('SELECT 1 FROM equipas WHERE dono_id = $1 AND id IN ($2, $3)', [donoId, aguias.id, leoes.id])).length === 2, 'a primeira conta confirmada herdou as equipas de exemplo');
  ok((await q('SELECT 1 FROM jogos WHERE dono_id = $1 AND id = 2', [donoId])).length === 1, 'a primeira conta confirmada herdou os jogos de exemplo');

  // Sair
  await Promise.all([p.waitForURL(/entrar\.html/), p.click('#conta-menu button')]);
  ok(!(await ctx.cookies()).some((c) => c.name === 'sessao'), 'sair: o cookie é apagado');
  ok((await q('SELECT 1 FROM sessoes WHERE utilizador_id = $1', [donoId])).length === 0, 'sair: a sessão é apagada na base de dados');
  await p.close();

  p = await pagina('/', { tolerar: ['401'], rapida: true });
  await p.waitForURL(/entrar\.html/);
  ok(new URL(p.url()).searchParams.get('voltar') === null, 'sem sessão: a lista de jogos também leva à entrada');

  // Entrar: palavra-passe errada e depois certa
  await p.fill('#entrar-email', emailPrincipal); await p.fill('#entrar-senha', 'errada-errada');
  await p.click('#botao-entrar');
  await p.waitForFunction(() => document.getElementById('erro-entrar').textContent.length > 0);
  ok((await p.locator('#erro-entrar').textContent()) === 'Email ou palavra-passe errados.', 'entrar: palavra-passe errada mostra o erro da API');
  ok((await p.locator('#botao-entrar').isEnabled()) && (await p.locator('#reenviar-entrar').isHidden()), 'entrar: o botão volta a ficar ativo e não oferece reenviar (a conta já está confirmada)');
  await p.fill('#entrar-senha', SENHA);
  await Promise.all([p.waitForURL((u) => u.pathname === '/'), p.click('#botao-entrar')]);
  await p.waitForSelector('.lista-jogos');
  ok(true, 'entrar: com os dados certos abre a lista de jogos');
  ok((await q('SELECT 1 FROM sessoes WHERE utilizador_id = $1', [donoId])).length === 1, 'entrar: cria uma sessão nova');
  await p.close();

  // Quem já tem sessão não fica na página de entrada, e o "voltar" nunca leva para fora do site
  for (const hostil of ['https://evil.example/', '//evil.example', 'javascript:alert(1)', '/\\evil.example', 'entrar.html']) {
    const h = await pagina(`/entrar.html?voltar=${encodeURIComponent(hostil)}`, { rapida: true });
    await h.waitForURL((u) => u.origin === new URL(servidor.url).origin && u.pathname === '/');
    ok(true, `entrar: o parâmetro voltar="${hostil}" não leva para fora do site`);
    await h.close();
  }

  // Registar o mesmo email antes de o confirmar pede outro email; depois de confirmado é «já existe»
  const ctxNovo = await novoContexto();
  const outro = await pagina('/entrar.html?modo=registo', { contexto: ctxNovo, tolerar: ['401'] });
  await outro.fill('#registo-nome', 'Outra pessoa'); await outro.fill('#registo-equipa', 'Outra FC'); await outro.fill('#registo-email', emailPrincipal); await outro.fill('#registo-senha', 'outra-palavra-1');
  await outro.click('#botao-registo');
  await outro.waitForFunction(() => document.getElementById('erro-registo').textContent.length > 0);
  ok((await outro.locator('#erro-registo').textContent()).includes('Já existe uma conta com esse email') && (await outro.locator('#reenviar-registo').isHidden()),
    'registo com o email de uma conta confirmada: «já existe» e sem oferta de reenviar');
  await outro.close();
  await ctxNovo.close();
});

// ======================= Recuperar a palavra-passe =======================
await passo('Recuperar a palavra-passe', async () => {
  const email = `recuperar-${sufixo}@exemplo.pt`;
  const NOVA = 'palavra-passe-nova-9';
  const ctxR = await novoContexto();   // outra pessoa, noutro browser

  // Uma conta confirmada (a primeira conta confirmada já ficou com os dados de exemplo)
  let p = await pagina('/entrar.html?modo=registo', { contexto: ctxR, tolerar: ['401'] });
  await registarPelaPagina(p, { nome: 'Rita Recupera', email, senha: SENHA });
  await p.waitForSelector('#painel-confirmar:not([hidden])');
  await p.close();
  const confirmacao = await abrirLinkDoEmail(email, { contexto: ctxR });
  await confirmacao.v.close();
  const [{ id: contaId }] = await q('SELECT id FROM utilizadores WHERE email = $1', [email]);
  ok((await q('SELECT 1 FROM equipas WHERE dono_id = $1', [contaId])).length === 1, 'recuperar: esta conta não é a primeira confirmada (não herda dados de exemplo: só tem a sua equipa)');

  // «Esqueci a palavra-passe» leva o email escrito para o ecrã de recuperação
  p = await pagina('/entrar.html', { contexto: ctxR, tolerar: ['401', '400'] });
  await p.fill('#entrar-email', email);
  await p.click('#esqueci');
  ok((await p.locator('#painel-esqueci').isVisible()) && (await p.locator('#entrada').isHidden()), 'esqueci: abre o ecrã de recuperação e esconde o formulário de entrada');
  ok((await p.inputValue('#esqueci-email')) === email, 'esqueci: leva o email que já estava escrito');
  await captura(p, 'esqueci');
  await p.fill('#esqueci-email', 'sem-arroba');
  await p.click('#botao-esqueci');
  ok((await p.locator('#erro-esqueci').textContent()).includes('email válido'), 'esqueci: email inválido recusado com mensagem');
  await p.fill('#esqueci-email', email);
  await p.click('#botao-esqueci');
  await p.waitForSelector('#ok-esqueci:not([hidden])');
  ok((await p.locator('#ok-esqueci').textContent()).includes('Se existir uma conta') && (await p.locator('#botao-esqueci').textContent()) === 'Enviar outra vez',
    'esqueci: a resposta não revela se a conta existe (e oferece enviar outra vez)');
  const [mensagem] = await esperarMensagens(email, 2);
  const texto = (await lerMensagem(mensagem.ID)).Text;
  ok(/palavra-passe/i.test(mensagem.Subject) && texto.includes('Olá Rita Recupera,') && texto.includes('redefinir.html?t='), 'email: chegou o email de recuperação com o nome e o link');
  const token = await ultimoToken(email, 2, 'redefinir');
  ok(!!token, 'email: o link tem um código');
  await p.click('#voltar-entrar');
  ok((await p.locator('#form-entrar').isVisible()) && (await p.inputValue('#entrar-email')) === email, 'esqueci: «Voltar a entrar» regressa ao formulário com o email');
  await p.close();

  // Email sem conta: o ecrã responde igual e não segue nenhum email
  const sem = await pagina('/entrar.html', { contexto: ctxR, tolerar: ['401'] });
  await sem.click('#esqueci');
  await sem.fill('#esqueci-email', `ninguem-${sufixo}@exemplo.pt`);
  await sem.click('#botao-esqueci');
  await sem.waitForSelector('#ok-esqueci:not([hidden])');
  ok((await sem.locator('#ok-esqueci').textContent()).includes('Se existir uma conta'), 'esqueci: email sem conta recebe a mesma resposta');
  ok((await mensagensPara(`ninguem-${sufixo}@exemplo.pt`)).length === 0, 'esqueci: para um email sem conta não segue nenhum email');
  await sem.close();

  // A página do link: validações e palavra-passe nova
  const r = await pagina(`/redefinir.html?t=${token}`, { contexto: ctxR, tolerar: ['400'] });
  await r.waitForSelector('#escolher:not([hidden])');
  ok(await r.evaluate(() => document.activeElement?.id === 'nova-senha'), 'redefinir: o campo da palavra-passe nova já está pronto a escrever');
  await captura(r, 'redefinir');
  await r.click('#botao-nova');
  ok((await r.locator('#erro-nova').textContent()).includes('pelo menos 8'), 'redefinir: palavra-passe curta recusada com mensagem');
  await r.fill('#nova-senha', ' '.repeat(10));
  await r.click('#botao-nova');
  ok((await r.locator('#erro-nova').textContent()).includes('só espaços'), 'redefinir: palavra-passe só com espaços recusada');
  await r.fill('#nova-senha', NOVA);
  await r.click('#ver-nova');
  ok((await r.getAttribute('#nova-senha', 'type')) === 'text' && (await r.textContent('#ver-nova')) === 'Esconder', 'redefinir: «Mostrar» revela a palavra-passe');
  await r.click('#botao-nova');
  await r.waitForSelector('#feito:not([hidden])');
  ok((await r.locator('#feito h1').textContent()) === 'Palavra-passe alterada', 'redefinir: mostra «Palavra-passe alterada»');
  ok(!new URL(r.url()).searchParams.has('t'), 'redefinir: o código sai do endereço depois de usado');
  await captura(r, 'redefinir-feito');
  const [conta] = await q('SELECT palavra_passe_hash FROM utilizadores WHERE id = $1', [contaId]);
  ok(/^pbkdf2-sha256\$600000\$/.test(conta.palavra_passe_hash) && !conta.palavra_passe_hash.includes(NOVA), 'base de dados: a palavra-passe nova fica só como hash PBKDF2');
  ok((await q('SELECT 1 FROM redefinicoes_palavra_passe WHERE utilizador_id = $1', [contaId])).length === 0, 'base de dados: o link ficou gasto');
  await r.close();

  // O mesmo link já não serve; a página explica e oferece um link novo
  const gasto = await pagina(`/redefinir.html?t=${token}`, { contexto: ctxR, tolerar: ['400'] });
  await gasto.waitForSelector('#escolher:not([hidden])');
  await gasto.fill('#nova-senha', 'outra-palavra-passe-1');
  await gasto.click('#botao-nova');
  await gasto.waitForSelector('#falhou:not([hidden])');
  ok((await gasto.locator('#erro-link').textContent()).includes('já foi usado') && (await gasto.locator('#form-novo-link').isVisible()), 'redefinir: um link já usado explica o motivo e oferece um link novo');
  ok(!new URL(gasto.url()).searchParams.has('t'), 'redefinir: o código recusado também sai do endereço');
  await gasto.fill('#novo-email', email);
  await gasto.click('#botao-novo-link');
  await gasto.waitForSelector('#ok-novo-link:not([hidden])');
  ok((await esperarMensagens(email, 3)).length === 3, 'redefinir: pedir um link novo envia outro email');
  await gasto.close();
  const semCodigo = await pagina('/redefinir.html', { contexto: ctxR, tolerar: ['400'] });
  await semCodigo.waitForSelector('#falhou:not([hidden])');
  ok((await semCodigo.locator('#erro-link').textContent()).includes('Falta o código'), 'redefinir: sem código no endereço explica o que falta');
  await semCodigo.close();

  // Entrar: a palavra-passe antiga já não serve, a nova sim
  p = await pagina('/entrar.html', { contexto: ctxR, tolerar: ['401', '400'] });
  await p.fill('#entrar-email', email); await p.fill('#entrar-senha', SENHA);
  await p.click('#botao-entrar');
  await p.waitForFunction(() => document.getElementById('erro-entrar').textContent.length > 0);
  ok((await p.locator('#erro-entrar').textContent()) === 'Email ou palavra-passe errados.', 'entrar: a palavra-passe antiga já não entra');
  await p.fill('#entrar-senha', NOVA);
  await Promise.all([p.waitForURL((u) => u.pathname === '/'), p.click('#botao-entrar')]);
  ok(true, 'entrar: a palavra-passe nova entra');
  await p.close();
  await ctxR.close();
});

// ======================= Equipas e jogadores =======================
await passo('Equipas e jogadores', async () => {
  const p = await pagina('/equipas.html');
  // Só aparece a equipa da conta: as equipas de exemplo que a conta herdou são adversárias e não se listam
  ok((await p.locator('.item-equipa').count()) === 1 && (await p.locator('.item-equipa').first().textContent()).includes(equipaPrincipal),
    'equipas: só aparece a equipa da conta (as de exemplo, adversárias, não se listam)');
  ok(await p.locator('.item-equipa[aria-current="true"]').count() === 1 && (await p.locator('#plantel h2').first().textContent()) === `Plantel · ${equipaPrincipal}`, 'equipas: a equipa da conta vem selecionada');
  ok(await p.locator('#form-equipa').isHidden(), 'equipas: quem já tem equipa não vê o formulário para criar outra');
  ok((await p.locator('h1').textContent()) === 'A tua equipa', 'equipas: o título diz «A tua equipa»');
  ok((await p.locator('#plantel .vazio').count()) === 1, 'equipas: o plantel novo está vazio');
  await captura(p, 'equipas');

  ok((await p.inputValue('#numero')) === '1', 'jogadores: número sugerido = 1');
  await p.fill('#nome', 'Rui Lopes'); await p.selectOption('#posicao', 'GR');
  await p.click('.formulario-jogador button[type=submit]');
  await p.waitForSelector('table.tabela tbody tr');
  ok((await p.inputValue('#numero')) === '2', 'jogadores: depois de adicionar sugere o 2');
  await p.fill('#nome', 'Tiago Reis'); await p.selectOption('#posicao', 'LE');
  await p.click('.formulario-jogador button[type=submit]');
  await p.waitForFunction(() => document.querySelectorAll('table.tabela tbody tr').length === 2);
  await p.fill('#nome', 'Joel Mota'); await p.selectOption('#posicao', 'PE');
  await p.click('.formulario-jogador button[type=submit]');
  await p.waitForFunction(() => document.querySelectorAll('table.tabela tbody tr').length === 3);
  ok(true, 'jogadores: 3 jogadores adicionados');
  ok(await esperarPor(async () => ((await p.locator('.item-equipa[aria-current="true"] small').textContent()) ?? '').includes('3')), 'equipas: contador de jogadores atualizado (3)');
  ok((await q('SELECT count(*)::int AS n FROM jogadores WHERE equipa_id = (SELECT id FROM equipas WHERE nome = $1)', [equipaPrincipal]))[0].n === 3, 'jogadores: gravados na base de dados');

  await p.fill('#numero', '2'); await p.fill('#nome', 'Duplicado');
  await p.click('.formulario-jogador button[type=submit]');
  await p.waitForFunction(() => document.querySelector('.formulario-jogador .erro-formulario').textContent.includes('número'));
  ok(true, 'jogadores: número repetido mostra o erro da API');

  await p.fill('#numero', '150'); await p.click('.formulario-jogador button[type=submit]');
  ok((await p.locator('.formulario-jogador .erro-formulario').textContent()).includes('1 e 99'), 'jogadores: número fora do intervalo recusado');

  await p.locator('tbody tr', { hasText: 'Joel Mota' }).getByRole('button', { name: /Editar/ }).click();
  ok(await p.locator('.botao:has-text("Cancelar")').isVisible(), 'jogadores: botão Cancelar visível a editar');
  await p.fill('#nome', 'Joel Mota Jr.'); await p.selectOption('#posicao', 'PD');
  await p.click('.formulario-jogador button[type=submit]');
  await p.waitForSelector('tbody tr:has-text("Joel Mota Jr.")');
  ok((await p.locator('tbody tr:has-text("Joel Mota Jr.") td').nth(2).textContent()) === 'Ponta direita', 'jogadores: edição guardada (nome e posição)');
  ok(!(await p.locator('.botao:has-text("Cancelar")').isVisible()), 'jogadores: Cancelar escondido depois de guardar');

  await p.locator('tbody tr', { hasText: 'Joel Mota Jr.' }).locator('.botao.perigo').click();
  await p.waitForFunction(() => document.querySelectorAll('table.tabela tbody tr').length === 2);
  ok(true, 'jogadores: apagar um jogador sem eventos');

  ok((await p.evaluate(() => location.search)) === '', 'equipas: sem escolher outra equipa o URL não muda');
  await p.close();

  // Um adversário abre-se a partir da convocatória (equipas.html?equipa=ID) e fica na lista enquanto a página estiver aberta
  const adv = await pagina(`/equipas.html?equipa=${aguias.id}`);
  await adv.waitForSelector('tbody tr:has-text("Rui Mesquita")');
  ok((await adv.locator('.item-equipa').count()) === 2 && (await adv.locator('.item-equipa[aria-current="true"]').textContent()).includes('Águias do Norte (adversário)'),
    'equipas: um adversário aberto pelo URL aparece ao lado da equipa da conta, marcado como adversário');
  ok((await adv.locator('tbody tr .botao.perigo:disabled').count()) === 8, 'jogadores: com eventos, o botão apagar está desativado');
  ok((await adv.evaluate(() => location.search)) === `?equipa=${aguias.id}`, 'equipas: o URL guarda a equipa escolhida');
  await adv.locator('.item-equipa', { hasText: equipaPrincipal }).click();
  await adv.waitForSelector('tbody tr:has-text("Rui Lopes")');
  ok((await adv.locator('.item-equipa').count()) === 2, 'equipas: o adversário continua na lista depois de voltar à equipa da conta');
  await adv.close();

  // Uma equipa de outra conta não se abre: fica só a equipa da conta
  const alheia = await pagina('/equipas.html?equipa=999999');
  await alheia.waitForSelector('#plantel h2');
  ok((await alheia.locator('.item-equipa').count()) === 1 && (await alheia.locator('#plantel h2').first().textContent()) === `Plantel · ${equipaPrincipal}`, 'equipas: um id que não é da conta mostra a equipa da conta');
  await alheia.close();
});

// ======================= Novo jogo =======================
let novoJogoId;
await passo('Novo jogo', async () => {
  const p = await pagina('/');
  ok((await p.locator('.jogo-linha').count()) >= 2, 'jogos: lista os jogos');
  ok((await p.locator('.jogo-linha', { hasText: 'Demonstração' }).locator('.resultado').textContent()).replace(/\s+/g, '') === '6–9', 'jogos: mostra o resultado de cada jogo (6–9)');
  ok((await p.locator('a[href^="/api/jogos/2/exportar.xlsx"]').count()) === 1, 'jogos: link de Excel em cada jogo');
  await captura(p, 'jogos');
  await p.click('summary');
  ok((await p.locator('#equipa-jogo').textContent()).includes(equipaPrincipal) && (await p.locator('#casa, #fora').count()) === 0,
    'jogos: o formulário mostra a equipa da conta e não pede a equipa da casa e a de fora');
  const sugestoes = await p.locator('#adversarios option').evaluateAll((o) => o.map((x) => x.value));
  ok(sugestoes.includes('Águias do Norte') && sugestoes.includes('Leões do Sul') && !sugestoes.includes(equipaPrincipal), 'jogos: os adversários que já existem aparecem como sugestão (a equipa da conta não)');
  await p.click('#criar-jogo');
  ok((await p.locator('#erro-jogo').textContent()).includes('nome do adversário'), 'jogos: sem adversário é recusado');
  await p.fill('#adversario', equipaPrincipal.toUpperCase());
  await p.click('#criar-jogo');
  ok((await p.locator('#erro-jogo').textContent()).includes('outra equipa'), 'jogos: a própria equipa como adversária é recusada (mesmo com outras maiúsculas)');
  await p.fill('#adversario', 'águias do norte');   // reaproveita a equipa que já existe, sem criar outra
  ok((await p.inputValue('#lado')) === 'casa', 'jogos: por omissão a equipa da conta joga em casa');
  await p.fill('#local', 'Pavilhão Central');
  await p.fill('#data-hora', '2026-11-20T18:30');
  await Promise.all([p.waitForURL(/convocatoria\.html\?jogo=\d+/), p.click('#criar-jogo')]);
  novoJogoId = Number(new URL(p.url()).searchParams.get('jogo'));
  const [jogo] = await q('SELECT * FROM jogos WHERE id = $1', [novoJogoId]);
  ok(jogo?.local === 'Pavilhão Central', 'jogos: novo jogo criado com o local');
  const [propria] = await q('SELECT equipa_id FROM utilizadores WHERE id = $1', [donoId]);
  ok(jogo?.equipa_casa_id === propria.equipa_id && jogo?.equipa_fora_id === aguias.id, 'jogos: a equipa da conta joga em casa contra a «Águias do Norte» que já existia');
  ok((await q("SELECT count(*)::int AS n FROM equipas WHERE lower(nome) = 'águias do norte' AND dono_id = $1", [donoId]))[0].n === 1, 'jogos: o adversário foi reaproveitado (não nasceu outra equipa com o mesmo nome)');
  ok(jogo && new Date(jogo.data_hora).toISOString() === '2026-11-20T18:30:00.000Z', 'jogos: data e hora enviadas (o browser do teste está em UTC)');
  await p.close();
});

// ======================= Convocatória =======================
await passo('Convocatória', async () => {
  const p = await pagina(`/convocatoria.html?jogo=${novoJogoId}`);
  await p.waitForSelector('.azulejo');
  const colunas = p.locator('.coluna-equipa');
  ok((await colunas.count()) === 2, 'convocatória: duas colunas');
  const contadores = await p.locator('.contador').allTextContents().then((l) => l.map((t) => t.replace(/\s+/g, '')));
  ok(contadores[0] === '2/16' && contadores[1] === '8/16', `convocatória: sem lista guardada vêm todos selecionados (${contadores})`);
  ok((await p.locator('.aviso-inline').count()) >= 2, 'convocatória: avisa que não havia lista guardada');
  ok(await p.locator('.barra-acoes button.primario').isEnabled(), 'convocatória: Guardar ativo (há alterações por guardar)');
  await captura(p, 'convocatoria');

  await colunas.nth(1).locator('.azulejo', { hasText: 'Tomás Faria' }).click();
  ok((await texto(colunas.nth(1).locator('.contador'))) === '7/16', 'convocatória: o contador desce para 7/16');
  await p.click('.barra-acoes button.primario');
  await p.waitForFunction(() => document.querySelector('.barra-acoes .estado').textContent.includes('guardada'));
  ok((await q('SELECT jogador_id FROM convocados WHERE jogo_id = $1', [novoJogoId])).length === 9, 'convocatória: 9 convocados guardados na base de dados');

  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('.azulejo');
  const depois = await p.locator('.contador').allTextContents().then((l) => l.map((t) => t.replace(/\s+/g, '')));
  ok(depois[0] === '2/16' && depois[1] === '7/16', `convocatória: depois de recarregar mantém a escolha (${depois})`);
  ok(await p.locator('.barra-acoes button.primario').isDisabled(), 'convocatória: Guardar desativado sem alterações');
  ok((await p.locator('.barra-acoes a[href*="exportar.xlsx"]').count()) === 1, 'convocatória: ligação para o Excel');
  await p.close();
});

// ======================= Máximo de 16 =======================
await passo('Máximo de 16 convocados por equipa', async () => {
  const [eq] = await q('INSERT INTO equipas (nome, dono_id) VALUES ($1, $2) RETURNING id', [`Gigantes ${sufixo}`, donoId]);
  for (let n = 1; n <= 17; n++) {
    await q('INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo) VALUES ($1,$2,$3,$4)', [eq.id, n, `Jogador ${n}`, n === 1 ? 'GR' : 'LE']);
  }
  const [jogo] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [eq.id, aguias.id, donoId]);

  const p = await pagina(`/convocatoria.html?jogo=${jogo.id}`);
  await p.waitForSelector('.azulejo');
  const col = p.locator('.coluna-equipa').nth(0);
  ok((await texto(col.locator('.contador'))) === '0/16', 'máximo: o plantel de 17 começa sem ninguém selecionado');
  await col.getByRole('button', { name: 'Todos' }).click();
  ok((await texto(col.locator('.contador'))) === '16/16', 'máximo: "Todos" seleciona só 16');
  ok((await col.locator('.contador.cheio').count()) === 1, 'máximo: contador marcado como cheio');
  ok((await col.locator('.azulejo:disabled').count()) === 1, 'máximo: o 17.º jogador fica desativado');
  await col.locator('.azulejo[aria-pressed="true"]').first().click();
  ok((await col.locator('.azulejo:disabled').count()) === 0, 'máximo: ao retirar um, volta a poder escolher');
  await col.getByRole('button', { name: 'Nenhum' }).click();
  ok((await texto(col.locator('.contador'))) === '0/16', 'máximo: "Nenhum" limpa a seleção');
  await p.close();
});

// ======================= Convocatória: ler a lista de uma foto =======================
await passo('Convocatória: ler a lista de uma foto', async () => {
  // A "foto" é um print de uma ficha de jogo desenhada aqui mesmo; o leitor (OCR) é o verdadeiro, a correr no browser.
  const ficha = [[1, 'RUI MESQUITA (GR)'], [3, 'TIAGO REIS'], [5, 'JOEL MOTA'], [7, 'ANDRÉ FERREIRA'], [9, 'MIGUEL CARVALHO'],
    [10, 'JOÃO PEREIRA'], [11, 'DIOGO MARQUES'], [13, 'FRANCISCO LOPES'], [17, 'RICARDO ALVES'], [21, 'BRUNO COSTA']];
  const desenho = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await desenho.setContent(`<style>body{font-family:Arial,Helvetica,sans-serif;margin:30px;background:#fff}table{border-collapse:collapse;font-size:22px}td,th{border:1px solid #333;padding:6px 14px}</style>
    <h2>FICHA DE JOGO — CONVOCATÓRIA</h2><p>Equipa: FALCÕES</p>
    <table><tr><th>N.º</th><th>NOME</th><th>LIC.</th></tr>${ficha.map(([n, nome], i) => `<tr><td>${n}</td><td>${nome}</td><td>${120000 + i * 37}</td></tr>`).join('')}</table>`);
  const ficheiroFicha = path.join(E2E_DIR, 'e2e-foto-ficha.png');
  await desenho.screenshot({ path: ficheiroFicha, fullPage: true });
  await desenho.setContent('<body style="background:#fff"></body>');
  const ficheiroVazio = path.join(E2E_DIR, 'e2e-foto-vazia.png');
  await desenho.screenshot({ path: ficheiroVazio });
  await desenho.close();

  // Uma equipa com dois jogadores que estão na ficha (#1 e #7, o #7 com outro nome) e um que não está (#20)
  const [eq] = await q('INSERT INTO equipas (nome, dono_id) VALUES ($1, $2) RETURNING id', [`Falcões ${sufixo}`, donoId]);
  for (const [n, nome, pos] of [[1, 'Rui Mesquita', 'GR'], [7, 'André Fonseca', 'LE'], [20, 'Zé Fora', 'PD']]) {
    await q('INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo) VALUES ($1,$2,$3,$4)', [eq.id, n, nome, pos]);
  }
  const [jogo] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [eq.id, aguias.id, donoId]);
  const toleradas = ['Error in ', 'Estimating resolution', 'Invalid resolution'];   // o leitor escreve avisos na consola
  const p = await pagina(`/convocatoria.html?jogo=${jogo.id}`, { tolerar: toleradas });
  await p.waitForSelector('.azulejo');
  const coluna = p.locator('.coluna-equipa').nth(0);
  ok((await coluna.getByRole('button', { name: 'Ler de uma foto' }).count()) === 1, 'foto: botão "Ler de uma foto" em cada equipa');
  await coluna.getByRole('button', { name: 'Ler de uma foto' }).click();
  const janela = p.locator('.janela-foto');
  await janela.waitFor();
  ok((await janela.locator('input[type=file]').count()) === 1, 'foto: a janela deixa escolher uma imagem');

  // Uma imagem em branco não dá jogadores: avisa e deixa tentar outra
  await janela.locator('input[type=file]').setInputFiles(ficheiroVazio);
  await janela.locator('.aviso-inline').waitFor({ timeout: 120000 });
  ok((await janela.locator('.aviso-inline').textContent()).includes('Não consegui ler nenhum jogador'), 'foto: imagem sem lista avisa que não leu ninguém');
  ok((await janela.locator('table.lista-foto tbody tr').count()) === 0, 'foto: imagem sem lista não inventa jogadores');
  await janela.getByRole('button', { name: 'Outra imagem' }).click();

  // A ficha: o leitor tem de apanhar quase todos, e os que já existem ficam ligados aos jogadores da equipa
  const t0 = Date.now();
  await janela.locator('input[type=file]').setInputFiles(ficheiroFicha);
  await janela.locator('table.lista-foto').waitFor({ timeout: 120000 });
  console.log(`   (lido em ${Date.now() - t0} ms)`);
  const lidas = await janela.locator('table.lista-foto tbody tr').evaluateAll((trs) => trs.map((tr) => ({
    numero: Number(tr.querySelector('.campo-numero').value), incluir: tr.querySelector('input[type=checkbox]').checked,
    nome: (tr.children[2].querySelector('input')?.value ?? tr.children[2].firstElementChild?.textContent ?? '').trim(),
    estado: tr.children[4].textContent.trim() })));
  const certos = ficha.filter(([n]) => lidas.some((l) => l.numero === n)).length;
  ok(certos >= 8, `foto: leu os números de pelo menos 8 dos 10 jogadores da ficha (leu ${certos}: ${lidas.map((l) => l.numero).join(', ')})`);
  const apelidoBate = ficha.filter(([n, nome]) => {
    const l = lidas.find((x) => x.numero === n);
    const sem = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    return l && sem(l.nome).replace(/\s/g, '').includes(sem(nome.replace(/ \(GR\)/, '').split(' ').at(-1)));
  }).length;
  ok(apelidoBate >= 7, `foto: leu o apelido de pelo menos 7 dos 10 jogadores (leu ${apelidoBate})`);
  const um = lidas.find((l) => l.numero === 1);
  const sete = lidas.find((l) => l.numero === 7);
  ok(!um || um.estado === 'Já está na equipa', 'foto: o #1 já está na equipa e fica ligado ao jogador que existe');
  ok(!sete || (sete.estado === 'Já está na equipa' && sete.nome.includes('André Fonseca')), 'foto: o #7 liga-se ao jogador da equipa com esse número (mostra o nome da equipa)');
  ok(lidas.filter((l) => l.estado === 'Novo na equipa').length >= 5, 'foto: os outros aparecem como novos na equipa');
  ok((await janela.locator('.resumo-foto').textContent()).includes('Ficam convocados'), 'foto: resumo do que vai acontecer');
  await captura(p, 'convocatoria-foto');

  // Corrigir à mão: tira o último jogador da lista e confirma
  const ultima = janela.locator('table.lista-foto tbody tr').last();
  const numeroUltimo = Number(await ultima.locator('.campo-numero').inputValue());
  await ultima.locator('input[type=checkbox]').uncheck();
  const incluidos = lidas.filter((l) => l.numero !== numeroUltimo);
  const novos = incluidos.filter((l) => l.estado === 'Novo na equipa');
  await janela.locator('.botao.primario', { hasText: 'Convocar' }).click();
  await janela.waitFor({ state: 'detached' });
  await p.waitForFunction(() => document.getElementById('aviso').textContent.includes('Guarda a convocatória'));
  ok(true, `foto: confirmada (${incluidos.length} convocados, ${novos.length} novos)`);

  const jogadoresBd = await q('SELECT numero, nome FROM jogadores WHERE equipa_id = $1 ORDER BY numero', [eq.id]);
  ok(jogadoresBd.length === 3 + novos.length, `foto: os novos jogadores foram criados na equipa (${jogadoresBd.length} no total)`);
  ok(novos.every((n) => jogadoresBd.some((j) => j.numero === n.numero && j.nome === n.nome)), 'foto: com o número e o nome que estavam no ecrã de rever');
  ok((await texto(coluna.locator('.contador'))) === `${incluidos.length}/16`, `foto: o contador mostra ${incluidos.length}/16`);
  const zeFora = coluna.locator('.azulejo', { hasText: 'Zé Fora' });
  ok((await zeFora.getAttribute('aria-pressed')) === 'false', 'foto: quem não vem na imagem fica fora da convocatória');

  await p.click('.barra-acoes button.primario');
  await p.waitForFunction(() => document.querySelector('.barra-acoes .estado').textContent.includes('guardada'));
  const convocados = await q('SELECT j.numero FROM convocados c JOIN jogadores j ON j.id = c.jogador_id WHERE c.jogo_id = $1 AND j.equipa_id = $2 ORDER BY j.numero', [jogo.id, eq.id]);
  ok(convocados.length === incluidos.length, `foto: ${incluidos.length} convocados guardados na base de dados (${convocados.length})`);
  ok(!convocados.some((c) => c.numero === 20), 'foto: o #20 não ficou convocado');
  await p.close();

  // Cancelar não mexe em nada
  const p2 = await pagina(`/convocatoria.html?jogo=${jogo.id}`, { tolerar: toleradas });
  await p2.waitForSelector('.azulejo');
  const antes = await texto(p2.locator('.coluna-equipa').nth(0).locator('.contador'));
  await p2.locator('.coluna-equipa').nth(0).getByRole('button', { name: 'Ler de uma foto' }).click();
  await p2.locator('.janela-foto').getByRole('button', { name: 'Cancelar' }).click();
  await p2.locator('.janela-foto').waitFor({ state: 'detached' });
  ok((await texto(p2.locator('.coluna-equipa').nth(0).locator('.contador'))) === antes, 'foto: cancelar não muda a convocatória');
  await p2.close();
});

// ======================= Banco: só convocados, registar remates =======================
await passo('Banco: só os convocados', async () => {
  const p = await pagina(`/banco.html?jogo=${novoJogoId}`);
  await p.waitForSelector('.botao-jogador');
  const nomes = await p.locator('.botao-jogador small').allTextContents();
  ok(nomes.length === 1 && nomes[0] === 'Tiago', `banco: só mostra os convocados de campo (${nomes})`);
  const opcoesGR = await p.locator('#guarda-redes option').allTextContents();
  ok(opcoesGR.length === 1 && opcoesGR[0].includes('Rui Mesquita'), `banco: o guarda-redes adversário só entre os convocados (${opcoesGR})`);
  ok(await p.locator('#nota-convocatoria').isHidden(), 'banco: sem nota quando há convocatória');
  await p.click('.a-atacar button[data-lado="fora"]');
  ok((await p.locator('.botao-jogador').count()) === 6, 'banco: a equipa de fora tem 6 jogadores de campo convocados');
  ok((await p.locator('.botao-jogador small:has-text("Tomás")').count()) === 0, 'banco: o guarda-redes não convocado não aparece');
  await p.close();

  const [{ id: semLista }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [aguias.id, leoes.id, donoId]);
  const p2 = await pagina(`/banco.html?jogo=${semLista}`);
  await p2.waitForSelector('.botao-jogador');
  ok((await p2.locator('.botao-jogador').count()) === 6, 'banco: sem convocatória mostra todos os jogadores de campo (6)');
  ok(await p2.locator('#nota-convocatoria').isVisible(), 'banco: nota a sugerir a convocatória');
  ok((await p2.locator('#nota-convocatoria a').getAttribute('href')) === `convocatoria.html?jogo=${semLista}`, 'banco: ligação para a convocatória');
  await p2.close();
});

// ======================= Tempo real: banco -> API -> dashboard =======================
await passo('Banco regista, dashboard recebe em tempo real', async () => {
  const [{ id: jogoId, codigo: codigoJogo }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id, codigo', [aguias.id, leoes.id, donoId]);
  const dash = await pagina(`/dashboard.html?jogo=${jogoId}`);
  ok(await esperarPor(async () => (await dash.locator('#ligacao').getAttribute('class'))?.includes('ok')), 'dashboard: ligado ao hub (em direto)');
  ok((await dash.locator('#ligacao').textContent()) === 'em direto', 'dashboard: estado "em direto"');
  ok((await texto(dash.locator('#golos-casa'))) === '0' && (await texto(dash.locator('#golos-fora'))) === '0', 'dashboard: começa em 0–0');

  // quem só tem o link (outro browser, sem sessão) também vê em direto
  const visitante = await pagina(`/dashboard.html?jogo=${jogoId}&c=${codigoJogo}`, { contexto: ctxVisitante, tolerar: ['401'] });
  ok(await esperarPor(async () => (await visitante.locator('#ligacao').getAttribute('class'))?.includes('ok')), 'visitante: ligado ao hub só com o código do link (sem conta)');

  const banco = await pagina(`/banco.html?jogo=${jogoId}`);
  await banco.waitForSelector('.botao-jogador');
  ok(await esperarPor(async () => (await banco.locator('#ligacao').getAttribute('class'))?.includes('ok')), 'banco: ligado ao hub');

  // toca no meio do mapa, escolhe o 1.º jogador e carrega em "Golo"
  const caixa = await banco.locator('#campo').boundingBox();
  await banco.locator('#campo').click({ position: { x: caixa.width * 0.5, y: caixa.height * 0.5 } });
  await banco.locator('.botao-jogador').first().click();
  ok(await banco.locator('#dica.pronto').count() === 1, 'banco: depois do mapa e do jogador está pronto a registar');
  await banco.click('.botao-resultado[data-resultado="GOLO"]');

  ok(await esperarPor(async () => (await q('SELECT 1 FROM eventos WHERE jogo_id = $1', [jogoId])).length === 1), 'banco: o golo ficou na base de dados');
  const [ev] = await q("SELECT * FROM eventos WHERE jogo_id = $1 AND tipo_evento_codigo = 'REMATE'", [jogoId]);
  ok(ev?.resultado === 'GOLO' && ev.equipa_id === aguias.id, 'banco: golo da equipa da casa');
  ok(ev && Number(ev.x) > 35 && Number(ev.x) < 65 && Number(ev.y) > 35 && Number(ev.y) < 65, `banco: coordenadas do toque no mapa (${ev?.x}, ${ev?.y})`);
  ok(ev?.guarda_redes_id != null && (await q('SELECT equipa_id FROM jogadores WHERE id = $1', [ev.guarda_redes_id]))[0]?.equipa_id === leoes.id, 'banco: guarda-redes da equipa adversária associado');

  await empurrar(banco, jogoId);
  await empurrar(dash, jogoId);
  ok(await esperarPor(async () => (await texto(dash.locator('#golos-casa'))) === '1'), 'dashboard: o golo aparece no placar sem recarregar (WebSocket)');
  ok(await esperarPor(async () => (await texto(banco.locator('#golos-casa'))) === '1'), 'banco: o placar também atualiza');
  await empurrar(visitante, jogoId, codigoJogo);
  ok(await esperarPor(async () => (await texto(visitante.locator('#golos-casa'))) === '1'), 'visitante: o golo também aparece no dashboard, sem conta');
  ok(await esperarPor(async () => (await dash.locator('svg.campo .camada-marcadores .marcador').count()) === 1), 'dashboard: o remate aparece no mapa');
  await captura(dash, 'dashboard-tempo-real');

  // um segundo remate: defesa do guarda-redes -> abre a baliza para marcar onde ele defendeu
  await banco.locator('#campo').click({ position: { x: caixa.width * 0.25, y: caixa.height * 0.55 } });
  await banco.locator('.botao-jogador').nth(1).click();
  await banco.click('.botao-resultado[data-resultado="DEFESA"]');
  await banco.waitForSelector('#janela-baliza:not([hidden])');
  ok((await banco.locator('#baliza .baliza-zona').count()) === 9, 'baliza: ao tocar em Defesa aparece a baliza com 9 zonas');
  ok((await banco.locator('#sub-baliza').textContent()).startsWith('Guarda-redes adversário: #'), 'baliza: a janela diz qual é o guarda-redes adversário');
  await captura(banco, 'banco-baliza');
  ok((await q('SELECT 1 FROM eventos WHERE jogo_id = $1', [jogoId])).length === 1, 'baliza: enquanto a janela está aberta a defesa ainda não foi gravada');

  // cancelar: nada fica registado e a escolha (mapa + jogador) mantém-se
  await banco.click('#baliza-cancelar');
  ok(await banco.locator('#janela-baliza').isHidden(), 'baliza: "Cancelar" fecha a janela');
  await new Promise((r) => setTimeout(r, 400));
  ok((await q('SELECT 1 FROM eventos WHERE jogo_id = $1', [jogoId])).length === 1, 'baliza: cancelar não regista a defesa');
  ok((await banco.locator('#dica.pronto').count()) === 1, 'baliza: depois de cancelar o mapa e o jogador continuam escolhidos');

  // tocar na zona "alto à esquerda" da baliza
  await banco.click('.botao-resultado[data-resultado="DEFESA"]');
  await banco.waitForSelector('#janela-baliza:not([hidden])');
  await banco.locator('#baliza .baliza-zona[data-zona="ALTO_ESQ"]').click();
  ok(await esperarPor(async () => (await q('SELECT 1 FROM eventos WHERE jogo_id = $1', [jogoId])).length === 2), 'baliza: a defesa ficou na base de dados depois de tocar na baliza');
  ok(await banco.locator('#janela-baliza').isHidden(), 'baliza: a janela fecha depois de tocar');
  const [defesa] = await q("SELECT * FROM eventos WHERE jogo_id = $1 AND resultado = 'DEFESA'", [jogoId]);
  ok(defesa?.baliza_zona === 'ALTO_ESQ', `baliza: zona calculada pela base de dados = ALTO_ESQ (${defesa?.baliza_zona})`);
  ok(defesa && Number(defesa.baliza_x) < 33.4 && Number(defesa.baliza_y) < 33.4, `baliza: coordenadas do toque (${defesa?.baliza_x}, ${defesa?.baliza_y})`);
  ok(await esperarPor(async () => (await texto(banco.locator('#aviso'))).includes('altoàesquerda')), 'baliza: o aviso diz onde foi a defesa');
  await empurrar(banco, jogoId);
  await empurrar(dash, jogoId);
  ok(await esperarPor(async () => (await banco.locator('#ultimos .zona-baliza').count()) >= 1), 'banco: últimos eventos mostram a zona da defesa');
  ok(await esperarPor(async () => (await dash.locator('svg.campo .camada-marcadores .marcador').count()) === 2), 'dashboard: 2 remates no mapa');
  ok((await texto(dash.locator('#golos-casa'))) === '1', 'dashboard: a defesa não altera o placar');
  ok(await esperarPor(async () => (await dash.locator('.baliza-dash .camada-marcadores .marcador').count()) === 1), 'dashboard: a defesa aparece na baliza');
  ok((await texto(dash.locator('.baliza-dash .baliza-zona[data-zona="ALTO_ESQ"] + .baliza-contagem'))) === '1', 'dashboard: a zona alto à esquerda tem 1 defesa');
  ok((await dash.locator('.zona-top').textContent()).includes('alto à esquerda'), 'dashboard: "Mais defesas" aponta para alto à esquerda');
  await captura(dash, 'dashboard-baliza');

  // terceiro remate: defesa sem local
  await banco.locator('#campo').click({ position: { x: caixa.width * 0.7, y: caixa.height * 0.4 } });
  await banco.locator('.botao-jogador').nth(2).click();
  await banco.click('.botao-resultado[data-resultado="DEFESA"]');
  await banco.waitForSelector('#janela-baliza:not([hidden])');
  await banco.click('#baliza-sem-local');
  ok(await esperarPor(async () => (await q('SELECT 1 FROM eventos WHERE jogo_id = $1', [jogoId])).length === 3), 'baliza: "Registar sem local" grava a defesa');
  const semLocal = (await q("SELECT * FROM eventos WHERE jogo_id = $1 AND resultado = 'DEFESA' ORDER BY id DESC", [jogoId]))[0];
  ok(semLocal && semLocal.baliza_x === null && semLocal.baliza_y === null && semLocal.baliza_zona === null, 'baliza: sem local fica sem coordenadas nem zona');
  await empurrar(banco, jogoId);
  await empurrar(dash, jogoId);
  ok(await esperarPor(async () => (await dash.locator('svg.campo .camada-marcadores .marcador').count()) === 3), 'dashboard: 3 remates no mapa');
  ok(await esperarPor(async () => (await dash.locator('.baliza-dash + p').textContent()).includes('1 de 2 defesas com local marcado (1 sem local)')), 'dashboard: o resumo conta a defesa sem local à parte');
  ok((await dash.locator('.baliza-dash .camada-marcadores .marcador').count()) === 1, 'dashboard: a defesa sem local não aparece na baliza');

  // desfazer o último (a defesa sem local)
  await banco.click('#btn-desfazer');
  ok(await esperarPor(async () => (await q('SELECT 1 FROM eventos WHERE jogo_id = $1', [jogoId])).length === 2), 'banco: "Desfazer último" apaga a defesa sem local');
  await empurrar(banco, jogoId);
  // o botão desfaz o 1.º da lista: espera que ela deixe de mostrar o evento já apagado
  await esperarPor(async () => (await banco.locator('#ultimos li').count()) === 2);
  await banco.click('#btn-desfazer');
  ok(await esperarPor(async () => (await q('SELECT 1 FROM eventos WHERE jogo_id = $1', [jogoId])).length === 1), 'banco: "Desfazer último" apaga a defesa da baliza');
  await empurrar(banco, jogoId);
  await empurrar(dash, jogoId);
  ok(await esperarPor(async () => (await dash.locator('svg.campo .camada-marcadores .marcador').count()) === 1), 'dashboard: volta a 1 remate no mapa');
  ok(await esperarPor(async () => (await dash.locator('.baliza-dash .camada-marcadores .marcador').count()) === 0), 'dashboard: a baliza fica sem defesas');

  // apagar o golo -> placar 0–0
  await esperarPor(async () => (await banco.locator('#ultimos li:not(.vazio)').count()) === 1);
  await banco.click('#btn-desfazer');
  ok(await esperarPor(async () => (await q('SELECT 1 FROM eventos WHERE jogo_id = $1', [jogoId])).length === 0), 'banco: o golo foi apagado');
  await empurrar(dash, jogoId);
  await empurrar(visitante, jogoId, codigoJogo);
  ok(await esperarPor(async () => (await texto(dash.locator('#golos-casa'))) === '0'), 'dashboard: o placar volta a 0');
  ok(await esperarPor(async () => (await texto(visitante.locator('#golos-casa'))) === '0'), 'visitante: o placar também volta a 0');
  await banco.close();
  await dash.close();
  await visitante.close();
});

// ======================= Banco: 3.º 2 minutos e vermelho direto expulsam =======================
await passo('Banco: o 3.º 2 minutos e o vermelho direto tiram o jogador do jogo', async () => {
  const [{ id: jogoId }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [aguias.id, leoes.id, donoId]);
  const banco = await pagina(`/banco.html?jogo=${jogoId}`);
  await banco.waitForSelector('.botao-jogador');
  ok(await esperarPor(async () => (await banco.locator('#ligacao').getAttribute('class'))?.includes('ok')), 'expulsões: banco ligado ao hub');
  const dash = await pagina(`/dashboard.html?jogo=${jogoId}`);
  await dash.waitForSelector('.placar');

  const botoes = banco.locator('.botao-jogador');
  const idA = await botoes.nth(0).getAttribute('data-jogador');
  const idB = await botoes.nth(1).getAttribute('data-jogador');
  const botaoA = banco.locator(`.botao-jogador[data-jogador="${idA}"]`);
  const botaoB = banco.locator(`.botao-jogador[data-jogador="${idB}"]`);
  const doisMinutos = banco.locator('#outros button', { hasText: /^2 minutos$/ });
  const vermelho = banco.locator('#outros button', { hasText: /^Vermelho direto$/ });
  const avisoDiz = async (trecho) => esperarPor(async () => ((await banco.locator('#aviso').textContent()) ?? '').includes(trecho), 4000);
  const eventosDe = async (tipo, jogador) => (await q('SELECT 1 FROM eventos WHERE jogo_id = $1 AND tipo_evento_codigo = $2 AND jogador_id = $3', [jogoId, tipo, jogador])).length;

  ok((await vermelho.count()) === 1 && (await doisMinutos.count()) === 1, 'expulsões: o banco tem o botão «Vermelho direto» ao lado dos «2 minutos»');
  ok((await botoes.count()) === 6 && (await banco.locator('.botao-jogador:disabled').count()) === 0, 'expulsões: no início todos os jogadores se podem escolher');

  // 1.º e 2.º 2 minutos: o contador sobe e o jogador continua disponível
  for (const vez of [1, 2]) {
    await botaoA.click();
    await doisMinutos.click();
    ok(await esperarPor(async () => (await eventosDe('DOIS_MINUTOS', idA)) === vez), `expulsões: o ${vez}.º «2 minutos» ficou registado`);
    await empurrar(banco, jogoId);
    ok(await esperarPor(async () => (await texto(botaoA.locator('.sancao'))) === `2′×${vez}`), `expulsões: o jogador mostra 2′×${vez}`);
    ok(await botaoA.isEnabled(), `expulsões: com ${vez} «2 minutos» o jogador ainda pode jogar`);
  }
  ok(!((await banco.locator('#aviso').textContent()) ?? '').includes('expulso'), 'expulsões: antes do 3.º não há aviso de expulsão');

  // 3.º 2 minutos: fica expulso
  await botaoA.click();
  await doisMinutos.click();
  ok(await avisoDiz('expulso (3.º 2 minutos)'), 'expulsões: o aviso diz que o jogador ficou expulso ao 3.º 2 minutos');
  ok(await esperarPor(async () => (await eventosDe('DOIS_MINUTOS', idA)) === 3), 'expulsões: o 3.º «2 minutos» ficou registado');
  await empurrar(banco, jogoId);
  ok(await esperarPor(async () => await botaoA.isDisabled()), 'expulsões: o jogador com 3 «2 minutos» já não se pode escolher');
  ok((await texto(botaoA.locator('em'))) === 'Expulso' && (await botaoA.getAttribute('class')).includes('expulso'), 'expulsões: o botão diz «Expulso» e fica a cinzento');
  ok(((await botaoA.getAttribute('title')) ?? '').includes('3 × 2 minutos'), 'expulsões: o motivo (3 × 2 minutos) aparece ao passar o rato');
  ok((await botoes.count()) === 6, 'expulsões: o jogador expulso continua na grelha (não desaparece)');
  ok((await banco.locator('.botao-jogador:disabled').count()) === 1, 'expulsões: só ele ficou desativado');
  ok(await banco.locator('#dica.pronto').count() === 0 && ((await banco.locator('#dica').textContent()) ?? '').includes('escolhe o jogador'), 'expulsões: depois da expulsão não fica nenhum jogador escolhido');
  await captura(banco, 'banco-expulso');

  // Vermelho direto sem jogador: não regista nada
  await vermelho.click();
  ok(await avisoDiz('Escolhe o jogador'), 'expulsões: «Vermelho direto» sem jogador pede para escolher o jogador');
  ok((await q("SELECT 1 FROM eventos WHERE jogo_id = $1 AND tipo_evento_codigo = 'VERMELHO'", [jogoId])).length === 0, 'expulsões: sem jogador o vermelho não fica registado');

  // Vermelho direto a outro jogador: expulso logo
  await botaoB.click();
  await vermelho.click();
  ok(await avisoDiz('expulso'), 'expulsões: o aviso diz que o vermelho expulsa o jogador');
  ok(await esperarPor(async () => (await eventosDe('VERMELHO', idB)) === 1), 'expulsões: o vermelho ficou registado');
  await empurrar(banco, jogoId);
  ok(await esperarPor(async () => await botaoB.isDisabled()), 'expulsões: o vermelho direto desativa logo o jogador');
  ok(((await botaoB.getAttribute('title')) ?? '').includes('vermelho direto'), 'expulsões: o motivo é «vermelho direto»');
  ok((await banco.locator('.botao-jogador:disabled').count()) === 2, 'expulsões: agora há dois jogadores expulsos');

  // O dashboard mostra quem está expulso e os remates antigos não desaparecem
  await empurrar(dash, jogoId);
  const sancoes = dash.locator('section.cartao', { has: dash.locator('h2', { hasText: 'Sanções' }) });
  ok(await esperarPor(async () => (await sancoes.locator('tbody tr').count()) === 2), 'expulsões: o dashboard tem um quadro «Sanções» com os dois jogadores');
  ok((await sancoes.locator('.etiqueta.expulso').count()) === 2, 'expulsões: ambos aparecem como «Expulso» no dashboard');
  const linhaA = sancoes.locator('tbody tr').filter({ has: dash.locator('td.num', { hasText: /^3$/ }) });
  ok((await linhaA.count()) === 1, 'expulsões: o dashboard mostra os 3 «2 minutos» do primeiro jogador');
  await captura(dash, 'dashboard-sancoes');

  // Enganos corrigem-se: apagar o vermelho devolve o jogador ao jogo
  await banco.click('#btn-desfazer');
  ok(await esperarPor(async () => (await eventosDe('VERMELHO', idB)) === 0), 'expulsões: apagar o vermelho tira o evento da base de dados');
  await empurrar(banco, jogoId);
  ok(await esperarPor(async () => await botaoB.isEnabled()), 'expulsões: sem o vermelho o jogador volta a poder ser escolhido');
  ok(await botaoA.isDisabled(), 'expulsões: o outro continua expulso');

  // Os eventos do expulso continuam na base de dados (e nas estatísticas)
  ok((await eventosDe('DOIS_MINUTOS', idA)) === 3, 'expulsões: os 3 «2 minutos» continuam registados depois da expulsão');
  await banco.close();
  await dash.close();
});

// ======================= Dashboard: Excel =======================
await passo('Dashboard: exportar para Excel', async () => {
  const [{ codigo }] = await q('SELECT codigo FROM jogos WHERE id = 2');
  const p = await pagina(`/dashboard.html?jogo=2&c=${codigo}`);
  await p.waitForSelector('.exportar a');
  ok((await p.locator('#excel-jogo').getAttribute('href')) === `/api/jogos/2/exportar.xlsx?c=${codigo}`, 'dashboard: botão Excel do topo (com o código do jogo)');
  const hrefs = await p.locator('.exportar a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  ok(hrefs[0].startsWith('/api/jogos/2/exportar.xlsx?equipaId=') && hrefs[0].endsWith(`&c=${codigo}`) && hrefs[1] === `/api/jogos/2/exportar.xlsx?c=${codigo}`, `dashboard: botões Excel da equipa e do jogo (${hrefs})`);
  await p.click('.separador-abas button:has-text("Ver: Leões")');
  const hrefs2 = await p.locator('.exportar a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  ok(hrefs2[0] !== hrefs[0], 'dashboard: o link do Excel acompanha a equipa selecionada');

  const [descarga] = await Promise.all([p.waitForEvent('download'), p.locator('.exportar a').first().click()]);
  const nome = descarga.suggestedFilename();
  const ficheiro = path.join(E2E_DIR, `e2e-${nome}`);
  await descarga.saveAs(ficheiro);
  const bytes = fs.readFileSync(ficheiro);
  if (SIGNALR_FALSO) {
    ok(/^estatisticas.*\.xlsx$/.test(nome), `dashboard: clicar descarrega um .xlsx (${nome})`);
  } else {
    ok(nome === 'estatisticas-leoes-do-sul-aguias-do-norte-vs-leoes-do-sul.xlsx', `dashboard: descarrega o Excel da equipa selecionada (${nome})`);
    ok(bytes.length > 2000 && bytes[0] === 0x50 && bytes[1] === 0x4b, `dashboard: o ficheiro descarregado é um .xlsx válido (${bytes.length} bytes)`);
  }

  ok((await p.locator('svg.campo .camada-marcadores .marcador').count()) > 0, 'dashboard: o mapa desenha os remates (SVG real)');
  const caixa = await p.locator('svg.campo').boundingBox();
  ok(caixa && caixa.width > 200 && caixa.height > 200, 'dashboard: o mapa tem tamanho visível');
  await captura(p, 'dashboard');
  await p.close();
});

// ======================= Jogos em direto na área de convidado =======================
await passo('Jogos das últimas 24 horas: o convidado vê-os sem link', async () => {
  // Um jogo a ser registado agora: 2–1 para os Tigres (os eventos entram direto na base de dados, como se viessem do banco)
  const [casa] = await q('INSERT INTO equipas (nome, dono_id) VALUES ($1, $2) RETURNING id', [`Tigres ${sufixo}`, donoId]);
  const [fora] = await q('INSERT INTO equipas (nome, dono_id) VALUES ($1, $2) RETURNING id', [`Lobos ${sufixo}`, donoId]);
  const [jogadorCasa] = await q("INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo) VALUES ($1, 7, 'Marco Tigre', 'LE') RETURNING id", [casa.id]);
  const [jogadorFora] = await q("INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo) VALUES ($1, 9, 'Nuno Lobo', 'PD') RETURNING id", [fora.id]);
  const [jogo] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id, local) VALUES ($1, $2, $3, $4) RETURNING id, codigo', [casa.id, fora.id, donoId, 'Pavilhão dos Tigres']);
  for (const [equipa, jogador, segundo] of [[casa.id, jogadorCasa.id, 100], [casa.id, jogadorCasa.id, 200], [fora.id, jogadorFora.id, 300]]) {
    await q("INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, resultado, x, y, parte, segundo_jogo) VALUES ($1,$2,'REMATE',$3,'GOLO',50,30,1,$4)", [jogo.id, equipa, jogador, segundo]);
  }
  const linhaDoJogo = (page) => page.locator('#lista-direto .jogo-direto', { hasText: `Tigres ${sufixo}` });
  const dashboardSemLink = `/dashboard.html?jogo=${jogo.id}`;

  // O convidado (sem conta, sem link) vê o jogo na lista, com o resultado
  const g = await pagina('/convidado.html', { contexto: ctxVisitante, tolerar: ['401'] });
  await linhaDoJogo(g).waitFor();
  const linha = linhaDoJogo(g);
  ok((await linha.textContent()).includes(`Lobos ${sufixo}`) && (await linha.textContent()).includes('Pavilhão dos Tigres'), 'em direto: a lista mostra as duas equipas e o local');
  ok((await texto(linha.locator('.jogo-direto-resultado'))) === '2–1', 'em direto: mostra o resultado (2–1)');
  ok((await linha.locator('small').textContent()).includes('último evento agora mesmo'), 'em direto: diz há quanto tempo foi o último evento');
  ok(await linha.evaluate((el) => el.classList.contains('ao-vivo')), 'em direto: com um evento agora o jogo leva o ponto verde de «a decorrer»');
  ok((await linha.locator('a').getAttribute('href')) === `dashboard.html?jogo=${jogo.id}`, 'em direto: a ligação abre o dashboard sem código');
  ok(!(await g.content()).includes(jogo.codigo), 'em direto: a página não traz o código do link de partilha');
  ok(await g.locator('#estado-direto').isHidden(), 'em direto: com jogos na lista não aparece o aviso de lista vazia');
  ok((await g.locator('#form-link').isVisible()), 'em direto: o campo para colar um link continua disponível');
  await captura(g, 'convidado-em-direto');
  const lista = await (await ctxVisitante.request.get(`${servidor.url}/api/convidado/jogos-em-direto`)).json();
  ok(lista.some((j) => j.id === jogo.id) && !JSON.stringify(lista).includes(jogo.codigo), 'em direto: a API não revela o código do link de partilha');

  // Abre o dashboard a partir da lista: vê o jogo sem link e sem poder partilhar
  await Promise.all([g.waitForURL(new RegExp(`dashboard\\.html\\?jogo=${jogo.id}$`)), linha.locator('a').click()]);
  await g.waitForSelector('.placar');
  ok(await esperarPor(async () => (await texto(g.locator('#golos-casa'))) === '2' && (await texto(g.locator('#golos-fora'))) === '1'), 'em direto: o dashboard abre-se sem link e mostra 2–1');
  ok((await g.locator('.sem-acesso').count()) === 0 && (await g.locator('#partilhar').isHidden()), 'em direto: sem aviso de «sem acesso» e sem botão de partilha (o convidado não recebe o código)');
  ok((await g.locator('#excel-jogo').getAttribute('href')) === `/api/jogos/${jogo.id}/exportar.xlsx`, 'em direto: o botão do Excel funciona sem código');
  ok((await ctxVisitante.request.get(`${servidor.url}/api/jogos/${jogo.id}/exportar.xlsx`)).status() === 200, 'em direto: e o Excel descarrega-se sem link');
  await g.close();

  // A lista atualiza sozinha (aqui com o relógio do browser adiantado): se o dono esconder o jogo, deixa de aparecer
  const g2 = await pagina('/convidado.html', { contexto: ctxVisitante, tolerar: ['401'], relogio: true });
  await linhaDoJogo(g2).waitFor();
  const meus = await pagina('/');
  const linhaDono = meus.locator('.jogo-linha', { hasText: `Tigres ${sufixo}` });
  const caixa = linhaDono.locator('.opcao-jogo input');
  ok((await caixa.isChecked()) && (await linhaDono.locator('.opcao-jogo').textContent()).includes('Mostrar na área de convidado'), 'dono: cada jogo traz «Mostrar na área de convidado», ligado por omissão');
  await captura(meus, 'jogos-visibilidade');
  await caixa.uncheck();
  ok(await esperarPor(async () => (await q('SELECT visivel_convidados FROM jogos WHERE id = $1', [jogo.id]))[0].visivel_convidados === false), 'dono: desligar guarda na base de dados que o jogo está escondido');
  ok(await esperarPor(async () => (await texto(meus.locator('#aviso'))).includes('Jogoescondido')), 'dono: aparece o aviso «Jogo escondido»');
  await g2.clock.fastForward(16000);
  ok(await esperarPor(async () => (await linhaDoJogo(g2).count()) === 0), 'em direto: a lista atualiza sozinha e o jogo escondido desaparece');

  // Escondido: sem link já não se abre; com o link continua
  const fechado = await pagina(dashboardSemLink, { contexto: ctxVisitante, tolerar: ['401', '404'] });
  ok(await esperarPor(async () => (await fechado.locator('.sem-acesso').count()) === 1), 'escondido: o dashboard sem link mostra «Este jogo não está disponível»');
  ok((await fechado.locator('.sem-acesso').textContent()).includes('foi escondido') && (await fechado.locator('.sem-acesso a[href="convidado.html"]').count()) === 1, 'escondido: explica que pode estar escondido e leva à área de convidado');
  await fechado.close();
  const comLink = await pagina(`${dashboardSemLink}&c=${jogo.codigo}`, { contexto: ctxVisitante, tolerar: ['401'] });
  ok(await esperarPor(async () => (await texto(comLink.locator('#golos-casa'))) === '2'), 'escondido: quem tem o link de partilha continua a ver o jogo');
  await comLink.close();
  await meus.reload({ waitUntil: 'networkidle' });
  ok(!(await meus.locator('.jogo-linha', { hasText: `Tigres ${sufixo}` }).locator('.opcao-jogo input').isChecked()), 'dono: depois de recarregar o jogo continua escondido');

  // Mostrar outra vez
  await meus.locator('.jogo-linha', { hasText: `Tigres ${sufixo}` }).locator('.opcao-jogo input').check();
  ok(await esperarPor(async () => (await q('SELECT visivel_convidados FROM jogos WHERE id = $1', [jogo.id]))[0].visivel_convidados === true), 'dono: voltar a ligar mostra o jogo outra vez');
  await g2.clock.fastForward(16000);
  ok(await esperarPor(async () => (await linhaDoJogo(g2).count()) === 1), 'em direto: e o jogo volta à lista');

  // Durante 24 horas o jogo continua na lista e abre-se sem link (já sem o ponto verde); passadas as 24 horas só com o link
  await q("UPDATE eventos SET criado_em = now() - interval '23 hours' WHERE jogo_id = $1", [jogo.id]);
  await g2.clock.fastForward(16000);
  ok(await esperarPor(async () => (await linhaDoJogo(g2).locator('small').textContent().catch(() => '')).includes('último evento há 23 horas')), 'em direto: 23 horas depois o jogo continua na lista («último evento há 23 horas»)');
  ok(!(await linhaDoJogo(g2).evaluate((el) => el.classList.contains('ao-vivo'))), 'em direto: e já sem o ponto verde');
  const aindaAberto = await pagina(dashboardSemLink, { contexto: ctxVisitante, tolerar: ['401'] });
  ok(await esperarPor(async () => (await texto(aindaAberto.locator('#golos-casa'))) === '2') && (await aindaAberto.locator('.sem-acesso').count()) === 0, 'em direto: o dashboard ainda se abre sem link ao fim de 23 horas');
  await aindaAberto.close();
  await q("UPDATE eventos SET criado_em = now() - interval '25 hours' WHERE jogo_id = $1", [jogo.id]);
  await g2.clock.fastForward(16000);
  ok(await esperarPor(async () => (await linhaDoJogo(g2).count()) === 0), 'em direto: passadas 24 horas o jogo sai da lista');
  const fechou = await pagina(dashboardSemLink, { contexto: ctxVisitante, tolerar: ['401', '404'] });
  ok(await esperarPor(async () => (await fechou.locator('.sem-acesso').count()) === 1), 'em direto: e sem o link já não se abre');
  ok((await fechou.locator('.sem-acesso').textContent()).includes('24 horas'), 'em direto: o aviso explica que passaram 24 horas');
  await fechou.close();
  const comLink25 = await pagina(`${dashboardSemLink}&c=${jogo.codigo}`, { contexto: ctxVisitante, tolerar: ['401'] });
  ok(await esperarPor(async () => (await texto(comLink25.locator('#golos-casa'))) === '2'), 'em direto: com o link de partilha continua a abrir');
  await comLink25.close();

  // Sem eventos conta a hora do jogo: um jogo que já devia ter começado e um que começa daqui a 3 horas aparecem; um de daqui a 2 dias não
  const novoJogoSemEventos = async (minutos, local) => (await q(
    "INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id, local, data_hora) VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5::int)) RETURNING id", [casa.id, fora.id, donoId, local, minutos]))[0].id;
  const semEventos = await novoJogoSemEventos(-10, 'Pavilhão Sem Eventos');
  const emBreve = await novoJogoSemEventos(180, 'Pavilhão Daqui a 3 Horas');
  const emDoisDias = await novoJogoSemEventos(2880, 'Pavilhão Daqui a 2 Dias');
  const g3 = await pagina('/convidado.html', { contexto: ctxVisitante, tolerar: ['401'] });
  const porLocal = (local) => g3.locator('#lista-direto .jogo-direto', { hasText: local });
  await porLocal('Pavilhão Sem Eventos').waitFor();
  ok((await porLocal('Pavilhão Sem Eventos').locator('small').textContent()).includes('ainda sem eventos') && (await texto(porLocal('Pavilhão Sem Eventos').locator('.jogo-direto-resultado'))) === '0–0',
    'sem eventos: o jogo aparece na lista como «ainda sem eventos» (0–0)');
  ok((await porLocal('Pavilhão Daqui a 3 Horas').locator('small').textContent()).includes('começa às'), 'sem eventos: um jogo que começa daqui a 3 horas diz a que horas começa');
  ok((await porLocal('Pavilhão Daqui a 2 Dias').count()) === 0, 'sem eventos: um jogo marcado para daqui a 2 dias ainda não aparece');
  ok(!(await porLocal('Pavilhão Sem Eventos').evaluate((el) => el.classList.contains('ao-vivo'))), 'sem eventos: e não leva o ponto verde');
  await captura(g3, 'convidado-24-horas');
  for (const [nome, id, esperado] of [['sem eventos', semEventos, 200], ['daqui a 3 horas', emBreve, 200], ['daqui a 2 dias', emDoisDias, 404]]) {
    ok((await ctxVisitante.request.get(`${servidor.url}/api/jogos/${id}/estatisticas`)).status() === esperado, `sem eventos (${nome}): abrir sem link = ${esperado}`);
  }
  await g3.close();
  await q('DELETE FROM jogos WHERE id = ANY($1)', [[semEventos, emBreve, emDoisDias]]);   // não ficam a aparecer nos passos seguintes
  await g2.close();
  await meus.close();
  // os eventos ficam com 25 horas: este jogo já não aparece nos passos seguintes
});

// ======================= Link de partilha =======================
await passo('Link de partilha: copiar e ver sem conta', async () => {
  const [{ codigo }] = await q('SELECT codigo FROM jogos WHERE id = 2');
  const [{ codigo: codigoNovo }] = await q('SELECT codigo FROM jogos WHERE id = $1', [novoJogoId]);

  // O dono copia o link do dashboard na lista de jogos
  const lista = await pagina('/');
  const linha = lista.locator('.jogo-linha', { hasText: 'Pavilhão Central' });
  ok((await linha.locator('a:has-text("Dashboard")').getAttribute('href')) === `dashboard.html?jogo=${novoJogoId}&c=${codigoNovo}`, 'jogos: o botão Dashboard já leva o código do jogo');
  await linha.getByRole('button', { name: 'Copiar link' }).click();
  await lista.waitForFunction(() => document.getElementById('aviso').textContent.includes('Link copiado'));
  const copiado = await lista.evaluate(() => navigator.clipboard.readText());
  ok(copiado === `${servidor.url}/dashboard.html?jogo=${novoJogoId}&c=${codigoNovo}`, `jogos: "Copiar link" copia o endereço de partilha (${copiado})`);
  await lista.close();

  // Quem recebe o link abre o dashboard num browser sem sessão
  const v = await pagina(`/dashboard.html?jogo=2&c=${codigo}`, { contexto: ctxVisitante, tolerar: ['401'] });
  ok(await esperarPor(async () => (await v.locator('#ligacao').getAttribute('class'))?.includes('ok')), 'visitante: o dashboard liga-se em direto sem conta');
  ok(await esperarPor(async () => (await texto(v.locator('#golos-casa'))) === '6' && (await texto(v.locator('#golos-fora'))) === '9'), 'visitante: vê o jogo 6–9');
  if (SIGNALR_FALSO) await empurrar(v, 2, codigo);
  ok((await v.locator('#voltar').isVisible()) && (await v.locator('#voltar').getAttribute('href')) === 'convidado.html', 'visitante: a seta leva à área de convidado (não à lista de jogos, que é da conta)');
  ok((await v.locator('svg.campo .camada-marcadores .marcador').count()) > 0, 'visitante: o mapa de remates aparece');
  await captura(v, 'dashboard-visitante');
  await v.click('#partilhar');
  ok((await v.evaluate(() => navigator.clipboard.readText())) === `${servidor.url}/dashboard.html?jogo=2&c=${codigo}`, 'visitante: "Copiar link" copia o mesmo endereço');
  const [descarga] = await Promise.all([v.waitForEvent('download'), v.click('#excel-jogo')]);
  const ficheiroVisitante = path.join(E2E_DIR, `e2e-visitante-${descarga.suggestedFilename()}`);
  await descarga.saveAs(ficheiroVisitante);
  const bytes = fs.readFileSync(ficheiroVisitante);
  ok(/\.xlsx$/.test(descarga.suggestedFilename()) && bytes[0] === 0x50 && bytes[1] === 0x4b, 'visitante: consegue exportar o Excel com o código do link');

  // O link só serve para ver: as outras páginas levam à entrada
  for (const destino of ['/', '/banco.html?jogo=2', '/convocatoria.html?jogo=2', '/equipas.html']) {
    const o = await pagina(destino, { contexto: ctxVisitante, tolerar: ['401'], rapida: true });
    await o.waitForURL(/entrar\.html/);
    ok(true, `visitante: ${destino} leva à página de entrada`);
    await o.close();
  }
  await v.close();

  // Sem código, com código errado ou com o código de outro jogo: o jogo "não existe"
  const semAcesso = [
    ['sem código', '/dashboard.html?jogo=2'], ['com código errado', '/dashboard.html?jogo=2&c=0123456789abcdef0123'],
    ['com o código de outro jogo', `/dashboard.html?jogo=2&c=${codigoNovo}`], ['jogo inexistente', '/dashboard.html?jogo=999999&c=0123456789abcdef0123'],
  ];
  for (const [nome, url] of semAcesso) {
    const n = await pagina(url, { contexto: ctxVisitante, tolerar: ['401', '404'] });
    ok(await esperarPor(async () => (await n.locator('.sem-acesso').count()) === 1), `visitante ${nome}: mostra "Este jogo não está disponível"`);
    ok((await n.locator('#ligacao').textContent()) === 'sem acesso' && (await n.locator('.placar').isHidden()), `visitante ${nome}: sem acesso, sem placar`);
    ok((await n.locator('.sem-acesso a[href^="entrar.html?voltar="]').count()) === 1 && (await n.locator('.sem-acesso a[href="convidado.html"]').count()) === 1, `visitante ${nome}: ligações para entrar na conta e para a área de convidado`);
    if (nome === 'sem código') await captura(n, 'dashboard-sem-acesso');
    await n.close();
  }
});

// ======================= Área de convidado =======================
await passo('Área de convidado: ver jogos só com o link', async () => {
  const [{ codigo }] = await q('SELECT codigo FROM jogos WHERE id = 2');
  const link = `${servidor.url}/dashboard.html?jogo=2&c=${codigo}`;
  const CHAVE = 'scouting.convidado.jogos';

  // Quem abriu os links dos passos anteriores (sem conta) já os tem na lista, com o último resultado visto
  const e = await pagina('/entrar.html', { contexto: ctxVisitante, tolerar: ['401'] });
  await Promise.all([e.waitForURL(/convidado\.html/), e.click('#entrar-convidado')]);
  await e.waitForSelector('#form-link');
  ok(true, 'convidado: «Entrar como convidado», na página de entrada, abre a área de convidado');
  ok((await e.locator('#link-conta').isVisible()) && (await e.locator('#link-conta').getAttribute('href')) === 'entrar.html', 'convidado: oferece «Tenho conta» a quem tem conta');
  ok((await e.locator('#vistos').isVisible()) && (await e.locator('.visto', { hasText: 'Águias do Norte vs Leões do Sul' }).filter({ hasText: '6–9' }).count()) === 1,
    'convidado: lembra os jogos que já abriu neste dispositivo, com o último resultado visto (6–9)');
  await captura(e, 'convidado');

  // Link inválido: explica o que falta
  await e.click('#form-link button[type=submit]');
  ok((await e.locator('#erro-link').textContent()).includes('Cola o link'), 'convidado: sem link pede para colar o link');
  for (const mau of ['isto não é um link', `${servidor.url}/dashboard.html?jogo=2&c=curto`, `${servidor.url}/dashboard.html?c=${codigo}`, `${servidor.url}/dashboard.html?jogo=0&c=${codigo}`]) {
    await e.fill('#link-jogo', mau);
    await e.click('#form-link button[type=submit]');
    ok((await e.locator('#erro-link').textContent()).includes('não parece o link de um jogo') && e.url().includes('convidado.html'), `convidado: recusa "${mau.replace(servidor.url, '')}" e fica na página`);
  }

  // Link bom, no meio de uma mensagem: abre o dashboard do jogo, sem conta
  await e.fill('#link-jogo', `Vê o jogo em direto: ${link} obrigado!`);
  await Promise.all([e.waitForURL(/dashboard\.html\?jogo=2&c=/), e.click('#form-link button[type=submit]')]);
  ok(await esperarPor(async () => (await e.locator('#ligacao').getAttribute('class'))?.includes('ok')), 'convidado: o link colado abre o dashboard em direto');
  ok(await esperarPor(async () => (await texto(e.locator('#golos-casa'))) === '6' && (await texto(e.locator('#golos-fora'))) === '9'), 'convidado: vê o jogo 6–9 sem conta');
  ok(await e.locator('#conta-menu .quem').count() === 0, 'convidado: no dashboard não aparece menu de conta');

  // A seta leva de volta à área de convidado, onde o jogo continua na lista; "Tirar" e "Limpar a lista" esvaziam-na
  await Promise.all([e.waitForURL(/convidado\.html/), e.click('#voltar')]);
  const antes = await e.locator('.visto').count();
  ok(antes >= 1, `convidado: de volta à área de convidado o jogo está na lista (${antes})`);
  await Promise.all([e.waitForURL(/dashboard\.html\?jogo=2/), e.locator('.visto-ligacao', { hasText: 'Águias do Norte' }).first().click()]);
  ok(true, 'convidado: abrir um jogo da lista leva ao dashboard');
  await Promise.all([e.waitForURL(/convidado\.html/), e.click('#voltar')]);
  await e.locator('.visto', { hasText: 'Águias do Norte' }).first().getByRole('button', { name: /Tirar/ }).click();
  ok((await e.locator('.visto').count()) === antes - 1, 'convidado: «Tirar» esquece só esse jogo');
  if (antes - 1 > 0) await e.click('#limpar-vistos');
  ok(await e.locator('#vistos').isHidden() && (await e.evaluate((c) => localStorage.getItem(c), CHAVE)) === null, 'convidado: «Limpar a lista» esvazia-a (e apaga o que estava guardado no browser)');
  await e.reload({ waitUntil: 'domcontentloaded' });
  await e.waitForSelector('#form-link');
  ok(await e.locator('#vistos').isHidden(), 'convidado: depois de recarregar a lista continua vazia');
  await e.close();

  // Quem tem conta não usa a área de convidado e o dashboard não lhe enche a lista
  const dono = await pagina('/convidado.html');
  ok((await dono.locator('#link-conta').count()) === 0 && (await dono.locator('#conta-menu a:has-text("Os meus jogos")').count()) === 1, 'convidado: com sessão iniciada oferece «Os meus jogos» em vez de «Tenho conta»');
  const dash = await pagina(`/dashboard.html?jogo=2&c=${codigo}`);
  ok(await esperarPor(async () => (await dash.locator('#ligacao').getAttribute('class'))?.includes('ok')), 'convidado: o dono também abre o link');
  ok((await dash.evaluate((c) => localStorage.getItem(c), CHAVE)) === null, 'convidado: quem tem conta não enche a lista de convidado');
  await dash.close();
  await dono.close();
});

// ======================= Segunda conta =======================
await passo('Segunda conta: começa vazia e não vê os dados da primeira', async () => {
  const ctxB = await novoContexto();
  const emailB = `bruno-${sufixo}@exemplo.pt`;
  const nomeEquipaB = `Segunda do Bruno ${sufixo}`;

  let p = await pagina('/', { contexto: ctxB, tolerar: ['401'], rapida: true });
  await p.waitForURL(/entrar\.html/);
  await registarPelaPagina(p, { nome: 'Bruno', equipa: nomeEquipaB, email: emailB, senha: 'outra-palavra-1' });
  await p.waitForSelector('#painel-confirmar:not([hidden])');
  ok((await ctxB.cookies()).every((c) => c.name !== 'sessao'), 'segunda conta: depois de registar ainda não tem sessão');
  const { v: linkB } = await abrirLinkDoEmail(emailB, { contexto: ctxB });
  await linkB.close();
  await p.click('#ja-confirmei');
  await p.fill('#entrar-senha', 'outra-palavra-1');
  await p.click('#botao-entrar');
  await p.waitForURL((u) => u.pathname === '/');
  await p.waitForSelector('.estado-vazio');
  const [b] = await q('SELECT id FROM utilizadores WHERE email = $1', [emailB]);
  ok(b?.id && b.id !== donoId, 'segunda conta: criada (conta diferente da primeira)');
  const equipasB = await q('SELECT e.nome, (e.id = u.equipa_id) AS propria FROM equipas e JOIN utilizadores u ON u.id = e.dono_id WHERE e.dono_id = $1', [b.id]);
  ok(equipasB.length === 1 && equipasB[0].nome === nomeEquipaB && equipasB[0].propria && (await q('SELECT 1 FROM jogos WHERE dono_id = $1', [b.id])).length === 0,
    'segunda conta: só tem a equipa que indicou ao criar a conta e nenhum jogo (não herda os dados de exemplo; só a primeira conta confirmada herda)');
  ok(await p.locator('#novo-jogo').isVisible(), 'segunda conta: com equipa já aparece «Novo jogo»');
  ok((await p.locator('.estado-vazio .passos li').count()) === 3 && (await p.locator('.estado-vazio button').count()) === 1, 'segunda conta: lista vazia mostra os 3 primeiros passos e «Criar o primeiro jogo»');
  ok((await p.locator('.jogo-linha').count()) === 0, 'segunda conta: não vê os jogos da primeira');
  await captura(p, 'conta-nova-vazia');

  // Equipas: só vê a sua; nenhuma das da primeira conta (nem a de exemplo «Águias do Norte»)
  await p.close();
  p = await pagina('/equipas.html', { contexto: ctxB });
  ok((await p.locator('.item-equipa').count()) === 1 && (await p.locator('.item-equipa').textContent()).includes(nomeEquipaB) && await p.locator('#form-equipa').isHidden(),
    'segunda conta: na página das equipas só vê a sua equipa e não pode criar outra');
  ok((await p.locator('.item-equipa', { hasText: equipaPrincipal }).count()) === 0, 'segunda conta: não vê as equipas da primeira');
  await p.close();

  // Criar o seu primeiro jogo: o adversário escreve-se (aqui com o nome de uma equipa da primeira conta e a jogar fora)
  p = await pagina('/', { contexto: ctxB });
  await p.click('.estado-vazio button');
  ok(await p.locator('#novo-jogo').evaluate((d) => d.open), 'segunda conta: "Criar o primeiro jogo" abre o formulário');
  ok((await p.locator('#adversarios option').count()) === 0, 'segunda conta: ainda não tem adversários para sugerir (não vê os da primeira)');
  await p.selectOption('#lado', 'fora');
  await p.fill('#adversario', 'Águias do Norte');
  await Promise.all([p.waitForURL(/convocatoria\.html\?jogo=\d+/), p.click('#criar-jogo')]);
  const jogoB = Number(new URL(p.url()).searchParams.get('jogo'));
  const [jogoDaB] = await q('SELECT * FROM jogos WHERE id = $1', [jogoB]);
  const [equipaDaB] = await q('SELECT equipa_id FROM utilizadores WHERE id = $1', [b.id]);
  ok(jogoDaB?.dono_id === b.id && jogoDaB.equipa_fora_id === equipaDaB.equipa_id, 'segunda conta: o jogo novo fica na segunda conta, com a sua equipa a jogar fora');
  ok((await q("SELECT 1 FROM equipas WHERE nome = 'Águias do Norte'")).length === 2 && (await q('SELECT 1 FROM equipas WHERE dono_id = $1', [b.id])).length === 2,
    'base de dados: duas equipas «Águias do Norte», cada uma do seu dono (a da segunda conta nasceu como adversária)');
  await p.close();

  p = await pagina('/', { contexto: ctxB });
  ok((await p.locator('.jogo-linha').count()) === 1 && (await p.locator('.estado-vazio').count()) === 0, 'segunda conta: a lista passa a ter só o seu jogo');
  await p.close();

  // Os jogos da primeira conta "não existem" aqui
  for (const [nome, url, seletor] of [
    ['convocatória', '/convocatoria.html?jogo=2', '#conteudo .vazio'], ['banco', '/banco.html?jogo=2', 'main .vazio'],
  ]) {
    const a = await pagina(url, { contexto: ctxB, tolerar: ['404'] });
    ok(await esperarPor(async () => ((await a.locator(seletor).first().textContent().catch(() => '')) ?? '').includes('Jogo não encontrado')), `segunda conta: ${nome} do jogo 2 (da primeira conta) = "Jogo não encontrado"`);
    await a.close();
  }
  const d = await pagina('/dashboard.html?jogo=2', { contexto: ctxB, tolerar: ['404'] });
  ok(await esperarPor(async () => (await d.locator('.sem-acesso').count()) === 1), 'segunda conta: dashboard do jogo 2 sem o link = indisponível');
  ok((await d.locator('.sem-acesso a').getAttribute('href')) === './', 'segunda conta: o botão leva de volta aos seus jogos (já tem conta)');
  await d.close();

  // Com o link de partilha, a segunda conta também vê o jogo 2 (mas continua sem poder mexer nele)
  const [{ codigo }] = await q('SELECT codigo FROM jogos WHERE id = 2');
  const comLink = await pagina(`/dashboard.html?jogo=2&c=${codigo}`, { contexto: ctxB });
  ok(await esperarPor(async () => (await texto(comLink.locator('#golos-casa'))) === '6'), 'segunda conta: com o link de partilha vê o jogo 2 em direto');
  ok(await comLink.locator('#voltar').isVisible(), 'segunda conta: com sessão o dashboard mostra a seta para os seus jogos');
  await comLink.close();

  // E a primeira conta não vê nada da segunda (um jogo novo está aberto a convidados durante 24 horas: a segunda conta esconde-o)
  await q('UPDATE jogos SET visivel_convidados = FALSE WHERE id = $1', [jogoB]);
  const alheio = await pagina(`/convocatoria.html?jogo=${jogoB}`, { tolerar: ['404'] });
  ok(await esperarPor(async () => ((await alheio.locator('#conteudo .vazio').first().textContent().catch(() => '')) ?? '').includes('Jogo não encontrado')), 'primeira conta: o jogo da segunda conta "não existe"');
  await alheio.close();
  const equipas = await pagina('/equipas.html');
  ok((await equipas.locator('.item-equipa', { hasText: nomeEquipaB }).count()) === 0, 'primeira conta: não vê as equipas da segunda');
  await equipas.close();

  // Sair da segunda conta não termina a sessão da primeira
  const sair = await pagina('/', { contexto: ctxB, tolerar: ['401'] });   // depois de sair, a página de entrada pergunta quem é (401)
  await Promise.all([sair.waitForURL(/entrar\.html/), sair.click('#conta-menu button')]);
  ok(!(await ctxB.cookies()).some((c) => c.name === 'sessao') && (await q('SELECT 1 FROM sessoes WHERE utilizador_id = $1', [donoId])).length >= 1, 'segunda conta: sair só termina a sua sessão');
  await sair.close();
  await ctxB.close();
});

// ======================= Resultado =======================
ok(errosPaginas.length === 0, `sem erros de JavaScript nem da consola${errosPaginas.length ? `: ${errosPaginas.join(' | ')}` : ''}`);
ok(semAssentar.length === 0, `todas as páginas assentam na rede${semAssentar.length ? `: ${semAssentar.join(' | ')}` : ''}`);
fs.writeFileSync(path.join(E2E_DIR, 'e2e.txt'), linhas.join('\n') + '\n');
await browser.close();
await servidor.fechar();
await bd.end();

if (falhas.length) {
  console.log(`\n${falhas.length} verificação(ões) falharam:\n- ${falhas.join('\n- ')}`);
  console.log(`::error title=Testes de browser (Chromium)::${falhas.slice(0, 25).join('%0A').replaceAll('\r', '').replaceAll('\n', '%0A')}`);
  process.exit(1);
}
console.log(`\nTodas as ${linhas.length} verificações passaram.`);
process.exit(0);
