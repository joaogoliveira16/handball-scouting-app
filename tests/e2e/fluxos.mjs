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
import zlib from 'node:zlib';
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
// Cada contexto é um "browser" à parte, com os seus próprios cookies (sessões).
// O service worker fica bloqueado: senão guardava páginas entre testes e tapava o que o Playwright simula com route()
// e clock. Só o passo «Sem rede» o deixa trabalhar (serviceWorkers: 'allow').
async function novoContexto({ serviceWorkers = 'block' } = {}) {
  const contexto = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'pt-PT', timezoneId: 'UTC', acceptDownloads: true, serviceWorkers });
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

// Num golo (e numa defesa) abre a baliza: toca-se na zona onde a bola entrou, ou em «Registar sem local»
async function golo(banco, zona = null) {
  await banco.click('.botao-resultado[data-resultado="GOLO"]');
  await banco.waitForSelector('#janela-baliza:not([hidden])');
  if (zona) await banco.locator(`#baliza .baliza-zona[data-zona="${zona}"]`).click();
  else await banco.click('#baliza-sem-local');
}

/** Um PNG de uma cor só (sem bibliotecas): serve para ver o escudo ser reduzido pelo browser. */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function criarPng(largura, altura, [r, g, b]) {
  const linha = Buffer.alloc(1 + largura * 4);   // o 1.º byte é o filtro (0 = nenhum)
  for (let x = 0; x < largura; x++) linha.set([r, g, b, 255], 1 + x * 4);
  const pedaco = (tipo, dados) => {
    const comprimento = Buffer.alloc(4);
    comprimento.writeUInt32BE(dados.length);
    const soma = Buffer.alloc(4);
    soma.writeUInt32BE(crc32(Buffer.concat([Buffer.from(tipo), dados])));
    return Buffer.concat([comprimento, Buffer.from(tipo), dados, soma]);
  };
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(largura, 0);
  cabecalho.writeUInt32BE(altura, 4);
  cabecalho[8] = 8;   // 8 bits por canal
  cabecalho[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', cabecalho),
    pedaco('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: altura }, () => linha)))),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}
const largura = (dados) => dados.readUInt32BE(16);   // o PNG guarda largura e altura logo a seguir ao nome IHDR
const altura = (dados) => dados.readUInt32BE(20);

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
  ok((await invalido.locator('#erro-confirmar').textContent()).includes('inválida ou já expirou') && (await invalido.locator('#form-novo-link').isVisible()), 'link inválido: explica o que se passou e oferece um link novo');
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
  ok((await gasto.locator('#erro-link').textContent()).includes('já foi usada') && (await gasto.locator('#form-novo-link').isVisible()), 'redefinir: um link já usado explica o motivo e oferece um link novo');
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

  ok((await p.locator('#posicao option').allTextContents()).at(-1) === 'UN · Universal' && (await p.locator('#posicao option').count()) === 8, 'jogadores: a posição «Universal» está entre as opções');
  ok((await p.inputValue('#numero')) === '1', 'jogadores: número sugerido = 1');
  await p.fill('#nome', 'Rui Lopes'); await p.selectOption('#posicao', 'GR');
  await p.click('.formulario-jogador button[type=submit]');
  await p.waitForSelector('table.tabela tbody tr');
  ok(await esperarPor(async () => (await p.inputValue('#numero')) === '2'), 'jogadores: depois de adicionar sugere o 2');
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
  ok(await esperarPor(async () => !(await p.locator('.botao:has-text("Cancelar")').isVisible())), 'jogadores: Cancelar escondido depois de guardar');

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

// ======================= Equipas: ler o plantel de uma foto =======================
await passo('Equipas: juntar ao plantel os jogadores lidos de uma foto', async () => {
  // A mesma ficha desenhada no passo da convocatória; aqui só se juntam à equipa os jogadores que ainda não existem
  const ficheiroFicha = path.join(E2E_DIR, 'e2e-foto-ficha.png');
  const [eq] = await q('INSERT INTO equipas (nome, dono_id) VALUES ($1, $2) RETURNING id', [`Corvos ${sufixo}`, donoId]);
  for (const [n, nome, pos] of [[1, 'Rui Mesquita', 'GR'], [7, 'André Fonseca', 'LE']]) {
    await q('INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo) VALUES ($1,$2,$3,$4)', [eq.id, n, nome, pos]);
  }
  const toleradas = ['Error in ', 'Estimating resolution', 'Invalid resolution'];   // o leitor escreve avisos na consola
  const p = await pagina(`/equipas.html?equipa=${eq.id}`, { tolerar: toleradas });
  await p.waitForSelector('#plantel table.tabela');
  ok((await p.locator('#plantel .cabecalho-plantel #ler-foto').count()) === 1 && (await p.locator('#ler-foto').isVisible()), 'plantel: botão "Ler de uma foto" ao lado do título do plantel');
  await p.click('#ler-foto');
  const janela = p.locator('.janela-foto');
  await janela.waitFor();
  ok(((await janela.textContent()) ?? '').includes('lista de jogadores'), 'plantel: a janela fala da lista de jogadores (não da convocatória)');
  await janela.locator('input[type=file]').setInputFiles(ficheiroFicha);
  await janela.locator('table.lista-foto').waitFor({ timeout: 120000 });
  const lidas = await janela.locator('table.lista-foto tbody tr').evaluateAll((trs) => trs.map((tr) => ({
    numero: Number(tr.querySelector('.campo-numero').value), incluir: tr.querySelector('input[type=checkbox]').checked, desativada: tr.querySelector('input[type=checkbox]').disabled,
    nome: (tr.children[2].querySelector('input')?.value ?? '').trim(), estado: tr.children[4].textContent.trim() })));
  const jaExistem = lidas.filter((l) => l.estado === 'Já está na equipa');
  const novas = lidas.filter((l) => l.estado === 'Novo na equipa');
  ok(jaExistem.every((l) => [1, 7].includes(l.numero) && !l.incluir && l.desativada), `plantel: quem já está na equipa não se volta a adicionar (${jaExistem.map((l) => l.numero)})`);
  ok(novas.length >= 5 && novas.every((l) => l.incluir && !l.desativada), `plantel: os outros vêm marcados para adicionar (${novas.length})`);
  const resumo = (await janela.locator('.resumo-foto').textContent()) ?? '';
  ok(resumo.includes(`Vão ser adicionados ${novas.length} jogadores à equipa`) && /já estão? na equipa/.test(resumo), `plantel: o resumo diz quantos se juntam e quantos já existiam (${resumo})`);
  ok(((await janela.locator('.botao.primario').last().textContent()) ?? '') === `Adicionar ${novas.length}`, 'plantel: o botão de confirmar diz «Adicionar» e quantos');
  await captura(p, 'equipas-foto');

  // Tirar o último e confirmar
  const ultima = janela.locator('table.lista-foto tbody tr').last();
  const numeroUltimo = Number(await ultima.locator('.campo-numero').inputValue());
  const estadoUltima = ((await ultima.locator('td').nth(4).textContent()) ?? '').trim();
  if (estadoUltima === 'Novo na equipa') await ultima.locator('input[type=checkbox]').uncheck();
  const juntar = novas.filter((l) => l.numero !== numeroUltimo);
  await janela.locator('.botao.primario', { hasText: 'Adicionar' }).click();
  await janela.waitFor({ state: 'detached' });
  await p.waitForFunction(() => document.getElementById('aviso').textContent.includes('adicionado'));
  ok(((await p.locator('#aviso').textContent()) ?? '').includes(`${juntar.length} jogadores adicionados ao plantel`), 'plantel: avisa quantos jogadores foram adicionados');
  const bd = await q('SELECT numero, nome, posicao_codigo FROM jogadores WHERE equipa_id = $1 ORDER BY numero', [eq.id]);
  ok(bd.length === 2 + juntar.length, `plantel: ficaram ${bd.length} jogadores na equipa (2 + ${juntar.length})`);
  ok(juntar.every((n) => bd.some((j) => j.numero === n.numero && j.nome === n.nome)), 'plantel: os novos entraram com o número e o nome do ecrã de rever');
  ok(bd.find((j) => j.numero === 7)?.nome === 'André Fonseca' && bd.find((j) => j.numero === 1)?.nome === 'Rui Mesquita', 'plantel: os jogadores que já existiam ficaram como estavam');
  ok(juntar.every((n) => bd.find((j) => j.numero === n.numero)?.posicao_codigo === 'CE'), 'plantel: os novos sem posição na imagem ficam como central');
  ok((await p.locator('#plantel table.tabela tbody tr').count()) === bd.length, 'plantel: a tabela do plantel já mostra os novos jogadores');
  ok(((await p.locator('.item-equipa[aria-current="true"] small').textContent()) ?? '').startsWith(`${bd.length} jog`), 'plantel: a lista de equipas atualiza o número de jogadores');

  // Ler outra vez a mesma imagem: já não há nada de novo para adicionar (o que ficou de fora é o único novo)
  await p.click('#ler-foto');
  await janela.waitFor();
  await janela.locator('input[type=file]').setInputFiles(ficheiroFicha);
  await janela.locator('table.lista-foto').waitFor({ timeout: 120000 });
  const novasDeNovo = await janela.locator('table.lista-foto tbody tr', { hasText: 'Novo na equipa' }).count();
  ok(novasDeNovo <= 1, `plantel: ao ler outra vez só sobra o jogador que tinha ficado de fora (${novasDeNovo})`);
  // Cancelar não mexe em nada
  await janela.getByRole('button', { name: 'Cancelar' }).click();
  await janela.waitFor({ state: 'detached' });
  ok((await q('SELECT 1 FROM jogadores WHERE equipa_id = $1', [eq.id])).length === bd.length, 'plantel: cancelar não adiciona ninguém');
  await p.close();
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

  // o golo também abre a baliza, para marcar onde a bola entrou
  await banco.click('.botao-resultado[data-resultado="GOLO"]');
  await banco.waitForSelector('#janela-baliza:not([hidden])');
  ok((await texto(banco.locator('#titulo-baliza'))) === 'Ondeentrouogolo?', 'golo na baliza: ao tocar em Golo a janela pergunta onde entrou');
  ok((await banco.locator('#sub-baliza').textContent()).startsWith('Golo contra o guarda-redes #'), 'golo na baliza: a janela diz contra que guarda-redes');
  ok((await banco.locator('#baliza .baliza-zona').count()) === 9, 'golo na baliza: a baliza tem 9 zonas');
  await captura(banco, 'banco-baliza-golo');
  ok((await q('SELECT 1 FROM eventos WHERE jogo_id = $1', [jogoId])).length === 0, 'golo na baliza: enquanto a janela está aberta o golo ainda não foi gravado');
  await banco.click('#baliza-cancelar');
  await new Promise((r) => setTimeout(r, 400));
  ok((await q('SELECT 1 FROM eventos WHERE jogo_id = $1', [jogoId])).length === 0 && (await banco.locator('#dica.pronto').count()) === 1, 'golo na baliza: cancelar não regista o golo e mantém o mapa e o jogador');
  await banco.click('.botao-resultado[data-resultado="GOLO"]');
  await banco.waitForSelector('#janela-baliza:not([hidden])');
  await banco.locator('#baliza .baliza-zona[data-zona="ALTO_DIR"]').click();

  ok(await esperarPor(async () => (await q('SELECT 1 FROM eventos WHERE jogo_id = $1', [jogoId])).length === 1), 'banco: o golo ficou na base de dados');
  const [ev] = await q("SELECT * FROM eventos WHERE jogo_id = $1 AND tipo_evento_codigo = 'REMATE'", [jogoId]);
  ok(ev?.resultado === 'GOLO' && ev.equipa_id === aguias.id, 'banco: golo da equipa da casa');
  ok(ev?.baliza_zona === 'ALTO_DIR' && Number(ev.baliza_x) > 66 && Number(ev.baliza_y) < 33.4, `golo na baliza: o local onde entrou ficou guardado (${ev?.baliza_zona}, ${ev?.baliza_x}, ${ev?.baliza_y})`);
  ok(await esperarPor(async () => (await texto(banco.locator('#aviso'))).includes('altoàdireita')), 'golo na baliza: o aviso diz onde entrou o golo');
  ok(ev && Number(ev.x) > 35 && Number(ev.x) < 65 && Number(ev.y) > 35 && Number(ev.y) < 65, `banco: coordenadas do toque no mapa (${ev?.x}, ${ev?.y})`);
  ok(ev?.guarda_redes_id != null && (await q('SELECT equipa_id FROM jogadores WHERE id = $1', [ev.guarda_redes_id]))[0]?.equipa_id === leoes.id, 'banco: guarda-redes da equipa adversária associado');

  await empurrar(banco, jogoId);
  await empurrar(dash, jogoId);
  ok(await esperarPor(async () => (await texto(dash.locator('#golos-casa'))) === '1'), 'dashboard: o golo aparece no placar sem recarregar (WebSocket)');
  ok(await esperarPor(async () => (await texto(banco.locator('#golos-casa'))) === '1'), 'banco: o placar também atualiza');
  await empurrar(visitante, jogoId, codigoJogo);
  ok(await esperarPor(async () => (await texto(visitante.locator('#golos-casa'))) === '1'), 'visitante: o golo também aparece no dashboard, sem conta');
  ok(await esperarPor(async () => (await dash.locator('svg.campo .camada-marcadores .marcador').count()) === 1), 'dashboard: o remate aparece no mapa');
  const cartaoGolos = dash.locator('section.cartao', { has: dash.locator('h2', { hasText: 'Golos na baliza' }) });
  const cartaoDefesas = dash.locator('section.cartao', { has: dash.locator('h2', { hasText: 'Defesas na baliza' }) });
  ok(await esperarPor(async () => (await cartaoGolos.locator('.baliza-dash .camada-marcadores .marcador').count()) === 1), 'dashboard: o golo aparece na baliza dos golos');
  ok((await texto(cartaoGolos.locator('.baliza-zona[data-zona="ALTO_DIR"] + .baliza-contagem'))) === '1', 'dashboard: a zona alto à direita tem 1 golo');
  ok((await cartaoGolos.locator('.zona-top').textContent()).includes('Mais golos') && (await cartaoGolos.locator('.zona-top').textContent()).includes('alto à direita'), 'dashboard: «Mais golos» aponta para alto à direita');
  ok((await cartaoGolos.locator('.baliza-dash + p').textContent()).includes('1 de 1 golo com local marcado'), 'dashboard: o resumo dos golos com local marcado');
  ok((await cartaoDefesas.locator('.baliza-dash .camada-marcadores .marcador').count()) === 0, 'dashboard: a baliza das defesas não leva o golo');
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
  ok(await esperarPor(async () => (await cartaoDefesas.locator('.baliza-dash .camada-marcadores .marcador').count()) === 1), 'dashboard: a defesa aparece na baliza');
  ok((await texto(cartaoDefesas.locator('.baliza-zona[data-zona="ALTO_ESQ"] + .baliza-contagem'))) === '1', 'dashboard: a zona alto à esquerda tem 1 defesa');
  ok((await cartaoDefesas.locator('.zona-top').textContent()).includes('alto à esquerda'), 'dashboard: "Mais defesas" aponta para alto à esquerda');
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
  ok(await esperarPor(async () => (await cartaoDefesas.locator('.baliza-dash + p').textContent()).includes('1 de 2 defesas com local marcado (1 sem local)')), 'dashboard: o resumo conta a defesa sem local à parte');
  ok((await cartaoDefesas.locator('.baliza-dash .camada-marcadores .marcador').count()) === 1, 'dashboard: a defesa sem local não aparece na baliza');

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
  ok(await esperarPor(async () => (await cartaoDefesas.locator('.baliza-dash .camada-marcadores .marcador').count()) === 0), 'dashboard: a baliza fica sem defesas');

  // apagar o golo -> placar 0–0
  await esperarPor(async () => (await banco.locator('#ultimos li:not(.vazio)').count()) === 1);
  await banco.click('#btn-desfazer');
  ok(await esperarPor(async () => (await q('SELECT 1 FROM eventos WHERE jogo_id = $1', [jogoId])).length === 0), 'banco: o golo foi apagado');
  await empurrar(dash, jogoId);
  ok(await esperarPor(async () => (await cartaoGolos.locator('.baliza-dash .camada-marcadores .marcador').count()) === 0), 'dashboard: apagado o golo, a baliza dos golos fica vazia');
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

// ======================= Superioridade numérica =======================
await passo('Superioridade: o banco conta os 2 minutos, marca o 7×6 e o dashboard acompanha o relógio', async () => {
  const [{ id: jogoId }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [aguias.id, leoes.id, donoId]);
  // O relógio falso do Playwright vale para todo o contexto (todas as páginas do browser): o banco fica num contexto
  // só dele (com a mesma sessão), para o dashboard continuar com o tempo verdadeiro. Os saltos de 10 minutos fazem
  // o SignalR do banco dar «Server timeout elapsed» (esperado: liga-se outra vez sozinho).
  const ctxBanco = await novoContexto();
  await ctxBanco.addCookies(await ctx.cookies());
  const banco = await pagina(`/banco.html?jogo=${jogoId}`, { contexto: ctxBanco, relogio: true, tolerar: ['Server timeout elapsed'] });
  await banco.waitForSelector('.botao-jogador');
  ok(await esperarPor(async () => (await banco.locator('#ligacao').getAttribute('class'))?.includes('ok')), 'superioridade: banco ligado ao hub');
  const dash = await pagina(`/dashboard.html?jogo=${jogoId}`);
  await dash.waitForSelector('.placar');

  const relogioBd = async () => (await q('SELECT segundo, a_correr FROM relogios_jogo WHERE jogo_id = $1', [jogoId]))[0];
  const faixaBanco = banco.locator('#faixa-numerica');
  const faixaDash = dash.locator('#painel .faixa-numerica');
  const restanteDe = async (faixa) => {
    const [m, sec] = ((await faixa.locator('.chip-numerica:not(.sete-seis) b').first().textContent()) ?? '0:00').split(':').map(Number);
    return m * 60 + sec;
  };

  ok(await faixaBanco.isHidden(), 'superioridade: sem sanções a faixa do banco está escondida');
  ok((await banco.locator('#btn-sete-seis').count()) === 1 && (await texto(banco.locator('#btn-sete-seis'))) === 'Ataque7×6', 'superioridade: o banco tem o botão «Ataque 7×6»');
  ok((await banco.locator('#outros button', { hasText: /início|fim/ }).count()) === 0, 'superioridade: o início e o fim do 7×6 não aparecem como eventos soltos');

  // Arrancar o relógio avisa o servidor; passados 10 minutos o aviso periódico corrige o segundo
  await banco.click('#btn-relogio');
  ok(await esperarPor(async () => (await relogioBd())?.a_correr === true), 'superioridade: ao arrancar, o servidor fica a saber que o relógio anda');
  await banco.clock.fastForward('10:00');
  ok(await esperarPor(async () => ((await relogioBd())?.segundo ?? 0) >= 595), `superioridade: o aviso periódico põe o relógio do servidor nos 10 minutos (${(await relogioBd())?.segundo} s)`);   // 595: o salto do relógio falso e o aviso podem ficar a milésimos de segundo um do outro

  // 2 minutos ao minuto 10: o banco mostra 6×5 para o adversário e a contagem decrescente
  const idA = await banco.locator('.botao-jogador').nth(0).getAttribute('data-jogador');
  await banco.locator(`.botao-jogador[data-jogador="${idA}"]`).click();
  await banco.locator('#outros button', { hasText: /^2 minutos$/ }).click();
  ok(await esperarPor(async () => (await q("SELECT segundo_jogo FROM eventos WHERE jogo_id = $1 AND tipo_evento_codigo = 'DOIS_MINUTOS'", [jogoId]))[0]?.segundo_jogo >= 600),
    'superioridade: o «2 minutos» ficou registado ao minuto 10');
  await empurrar(banco, jogoId);
  ok(await esperarPor(async () => await faixaBanco.isVisible()), 'superioridade: com um jogador a menos aparece a faixa no banco');
  ok((await texto(faixaBanco.locator('.rotulo-numerica'))) === '6×5', 'superioridade: a casa joga com 5 e o adversário com 6 (6×5)');
  ok(((await faixaBanco.textContent()) ?? '').includes('Superioridade · Leões do Sul'), 'superioridade: a faixa diz quem está em superioridade');
  const inicio = await restanteDe(faixaBanco);
  ok(inicio >= 115 && inicio <= 120, `superioridade: a contagem começa nos 2 minutos (${inicio} s)`);
  ok((await faixaBanco.locator('.chip-numerica').first().textContent())?.startsWith('#'), 'superioridade: a contagem traz o número do jogador');
  await captura(banco, 'banco-superioridade');

  // O dashboard (outro ecrã) vê o relógio a andar e a mesma contagem
  await empurrar(dash, jogoId);
  ok(await esperarPor(async () => await dash.locator('#relogio-dash').isVisible()), 'superioridade: o dashboard mostra o relógio do jogo');
  ok(/^10:[0-3]\d$/.test((await texto(dash.locator('#relogio-dash'))) ?? ''), `superioridade: o relógio do dashboard está nos 10 minutos (${await texto(dash.locator('#relogio-dash'))})`);
  ok((await dash.locator('#relogio-dash.parado').count()) === 0, 'superioridade: com o relógio a andar não aparece como parado');
  ok(await esperarPor(async () => await faixaDash.isVisible()) && (await texto(faixaDash.locator('.rotulo-numerica'))) === '6×5', 'superioridade: o dashboard mostra a faixa 6×5');
  const noDash = await restanteDe(faixaDash);
  ok(noDash >= 80 && noDash <= 120, `superioridade: o dashboard conta os 2 minutos a partir do relógio do servidor (${noDash} s)`);
  await captura(dash, 'dashboard-superioridade');

  // Passado 1 minuto de jogo faltam cerca de 60 segundos
  await banco.clock.fastForward('01:00');
  ok(await esperarPor(async () => { const r = await restanteDe(faixaBanco); return r >= 55 && r <= 61; }), `superioridade: ao fim de 1 minuto faltam cerca de 60 s (${await restanteDe(faixaBanco)} s)`);

  // 7×6: liga e desliga sem mexer no jogador escolhido
  await banco.locator(`.botao-jogador[data-jogador="${idA}"]`).click();
  await banco.click('#btn-sete-seis');
  ok(await esperarPor(async () => (await q("SELECT 1 FROM eventos WHERE jogo_id = $1 AND tipo_evento_codigo = 'SETE_SEIS_INICIO' AND jogador_id IS NULL", [jogoId])).length === 1), 'superioridade: o início do 7×6 ficou registado (da equipa, sem jogador)');
  await empurrar(banco, jogoId);
  ok(await esperarPor(async () => (await texto(banco.locator('#btn-sete-seis'))) === '7×6ligado·desligar'), 'superioridade: o botão passa a «7×6 ligado · desligar»');
  ok((await banco.locator('#btn-sete-seis').getAttribute('aria-pressed')) === 'true', 'superioridade: o botão do 7×6 diz que está ligado');
  ok(((await faixaBanco.locator('.chip-numerica.sete-seis').textContent()) ?? '').includes('7×6 · Águias do Norte'), 'superioridade: a faixa mostra quem ataca em 7×6');
  ok((await banco.locator(`.botao-jogador[data-jogador="${idA}"].ativo`).count()) === 1, 'superioridade: ligar o 7×6 não tira o jogador escolhido');
  await banco.click('#btn-sete-seis');
  ok(await esperarPor(async () => (await q("SELECT 1 FROM eventos WHERE jogo_id = $1 AND tipo_evento_codigo = 'SETE_SEIS_FIM'", [jogoId])).length === 1), 'superioridade: o fim do 7×6 ficou registado');
  await empurrar(banco, jogoId);
  ok(await esperarPor(async () => (await texto(banco.locator('#btn-sete-seis'))) === 'Ataque7×6'), 'superioridade: desligado, o botão volta a «Ataque 7×6»');
  ok((await faixaBanco.locator('.chip-numerica.sete-seis').count()) === 0, 'superioridade: sem 7×6 a faixa já não o mostra');

  // Acabados os 2 minutos a faixa desaparece sozinha
  await banco.clock.fastForward('01:10');
  ok(await esperarPor(async () => await faixaBanco.isHidden()), 'superioridade: ao fim dos 2 minutos a faixa desaparece');

  // O 7×6 não conta como «outro evento» no dashboard
  await empurrar(dash, jogoId);
  const outros = dash.locator('section.cartao', { has: dash.locator('h2', { hasText: 'Outros eventos' }) });
  ok(await esperarPor(async () => (await outros.locator('tbody tr').count()) >= 1) && (await outros.textContent()).includes('2 minutos') && !(await outros.textContent()).includes('7×6'),
    'superioridade: «Outros eventos» mostra os 2 minutos e não conta o início e o fim do 7×6');

  // Parar o relógio: o dashboard mostra-o parado
  await banco.click('#btn-relogio');
  ok(await esperarPor(async () => (await relogioBd())?.a_correr === false), 'superioridade: ao parar, o servidor fica a saber que o relógio parou');
  await empurrar(dash, jogoId);
  ok(await esperarPor(async () => (await dash.locator('#relogio-dash.parado').count()) === 1), 'superioridade: o dashboard mostra o relógio parado');
  await banco.close();
  await ctxBanco.close();
  await dash.close();
});

// ======================= Time-out =======================
await passo('Time-out: o relógio de jogo pára e o minuto do time-out desconta até zero', async () => {
  const [{ id: jogoId }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [aguias.id, leoes.id, donoId]);
  const ctxBanco = await novoContexto();   // o relógio falso fica só neste contexto (como na superioridade numérica)
  await ctxBanco.addCookies(await ctx.cookies());
  const banco = await pagina(`/banco.html?jogo=${jogoId}`, { contexto: ctxBanco, relogio: true, tolerar: ['Server timeout elapsed'] });
  await banco.waitForSelector('.botao-jogador');
  ok(await esperarPor(async () => (await banco.locator('#ligacao').getAttribute('class'))?.includes('ok')), 'time-out: banco ligado ao hub');

  const relogioBd = async () => (await q('SELECT segundo, a_correr FROM relogios_jogo WHERE jogo_id = $1', [jogoId]))[0];
  const nTimeouts = async () => (await q("SELECT 1 FROM eventos WHERE jogo_id = $1 AND tipo_evento_codigo = 'TIMEOUT'", [jogoId])).length;
  const faixa = banco.locator('#faixa-timeout');
  const tempoJogo = () => texto(banco.locator('#tempo'));
  const minuto = async () => {
    const [m, sec] = ((await texto(banco.locator('#timeout-tempo'))) ?? '0:00').split(':').map(Number);
    return m * 60 + sec;
  };
  const pedirTimeout = () => banco.locator('#outros button', { hasText: /^Time-out$/ }).click();

  ok(await faixa.isHidden(), 'time-out: sem time-out a faixa está escondida');

  // Relógio a andar até aos 5 minutos
  await banco.click('#btn-relogio');
  ok(await esperarPor(async () => (await relogioBd())?.a_correr === true), 'time-out: o relógio de jogo arrancou');
  await banco.clock.fastForward('05:00');
  ok(await esperarPor(async () => /^05:0\d$/.test((await tempoJogo()) ?? '')), `time-out: o relógio de jogo está nos 5 minutos (${await tempoJogo()})`);

  // Pedir o time-out: o relógio pára e aparece o minuto
  await pedirTimeout();
  ok(await esperarPor(async () => await faixa.isVisible()), 'time-out: aparece a faixa do time-out');
  ok(await esperarPor(async () => (await texto(banco.locator('#btn-relogio'))) === '▶'), 'time-out: o relógio de jogo fica parado (▶)');
  ok(await esperarPor(async () => (await relogioBd())?.a_correr === false), 'time-out: o servidor fica a saber que o relógio parou');
  const inicial = await minuto();
  ok(inicial >= 58 && inicial <= 60, `time-out: o minuto começa em 1:00 (${inicial} s)`);
  ok(((await faixa.textContent()) ?? '').includes('Águias do Norte') && ((await faixa.textContent()) ?? '').includes('relógio de jogo parado'),
    'time-out: a faixa diz que equipa pediu e que o relógio de jogo está parado');
  ok(await esperarPor(async () => (await nTimeouts()) === 1), 'time-out: o evento ficou registado');
  const [{ segundo_jogo: segTimeout }] = await q("SELECT segundo_jogo FROM eventos WHERE jogo_id = $1 AND tipo_evento_codigo = 'TIMEOUT'", [jogoId]);
  ok(segTimeout >= 300 && segTimeout <= 302, `time-out: o evento leva o segundo em que o relógio estava (${segTimeout} s)`);
  await captura(banco, 'banco-timeout');

  // Passam 30 segundos: o relógio de jogo não anda, o minuto desconta
  const parado = await tempoJogo();
  await banco.clock.fastForward('00:30');
  ok(await esperarPor(async () => { const r = await minuto(); return r >= 28 && r <= 31; }), `time-out: passados 30 s faltam cerca de 30 s (${await minuto()} s)`);
  ok((await tempoJogo()) === parado, `time-out: o relógio de jogo continua parado nos ${parado}`);

  // Acaba o minuto: fica a zero à espera de se retomar o jogo
  await banco.clock.fastForward('00:32');
  // (cada tentativa avança mais 1 s: o relógio simulado só dispara cada temporizador uma vez por salto)
  ok(await esperarPor(async () => { await banco.clock.fastForward('00:01'); return (await faixa.getAttribute('class'))?.includes('acabou'); }),
    'time-out: ao fim do minuto a faixa avisa que acabou');
  ok((await minuto()) === 0 && ((await faixa.textContent()) ?? '').includes('fim do time-out'), 'time-out: o minuto chega a 0:00 e diz «fim do time-out»');
  ok((await tempoJogo()) === parado && (await texto(banco.locator('#btn-relogio'))) === '▶', 'time-out: acabou o minuto mas o relógio de jogo só anda quando se retomar');

  // Retomar o jogo: a faixa sai e o relógio volta a andar
  await banco.click('#btn-fim-timeout');
  ok(await faixa.isHidden(), 'time-out: «Retomar o jogo» esconde a faixa');
  ok(await esperarPor(async () => (await texto(banco.locator('#btn-relogio'))) === '⏸'), 'time-out: «Retomar o jogo» põe o relógio de jogo a andar');
  ok(await esperarPor(async () => (await relogioBd())?.a_correr === true), 'time-out: o servidor fica a saber que o jogo retomou');
  await banco.clock.fastForward('00:10');
  ok(await esperarPor(async () => (await tempoJogo()) !== parado), 'time-out: depois de retomar o relógio de jogo anda');

  // Carregar em ▶ durante um time-out também retoma o jogo
  await pedirTimeout();
  ok(await esperarPor(async () => await faixa.isVisible() && (await nTimeouts()) === 2), 'time-out: segundo time-out registado, a faixa volta');
  ok((await texto(banco.locator('#btn-relogio'))) === '▶', 'time-out: o relógio parou outra vez');
  await banco.click('#btn-relogio');
  ok(await faixa.isHidden() && (await texto(banco.locator('#btn-relogio'))) === '⏸', 'time-out: ▶ durante o time-out acaba-o e retoma o jogo');

  // Enganou-se no time-out: apagar o evento cancela o minuto (e o relógio fica parado)
  await pedirTimeout();
  ok(await esperarPor(async () => await faixa.isVisible() && (await nTimeouts()) === 3), 'time-out: terceiro time-out registado');
  await empurrar(banco, jogoId);
  await esperarPor(async () => (await banco.locator('#ultimos li:not(.pendente)').count()) >= 1);
  await banco.click('#btn-desfazer');
  ok(await esperarPor(async () => (await nTimeouts()) === 2), 'time-out: apagar o evento tira-o da base de dados');
  ok(await esperarPor(async () => await faixa.isHidden()), 'time-out: apagar o time-out cancela o minuto');
  ok((await texto(banco.locator('#btn-relogio'))) === '▶', 'time-out: o relógio continua parado até alguém o retomar');

  // Mudar de parte acaba o time-out
  await pedirTimeout();
  ok(await esperarPor(async () => await faixa.isVisible() && (await nTimeouts()) === 3), 'time-out: novo time-out na 1.ª parte');
  await banco.click('#btn-parte');
  ok(await faixa.isHidden() && (await texto(banco.locator('#btn-parte'))) === '2.ªparte', 'time-out: mudar de parte acaba o time-out');
  await banco.close();
  await ctxBanco.close();

  // Recarregar a página (ou fechar e abrir o tablet) não perde o minuto
  const real = await pagina(`/banco.html?jogo=${jogoId}`);
  await real.waitForSelector('.botao-jogador');
  await real.evaluate(({ chave, equipaId }) => localStorage.setItem(chave, JSON.stringify({
    acumuladoMs: 301000, iniciadoEm: null, parte: 1, timeout: { ate: Date.now() + 40000, equipaId },
  })), { chave: `relogio-jogo-${jogoId}`, equipaId: leoes.id });
  await real.reload({ waitUntil: 'domcontentloaded' });
  await real.locator('#faixa-timeout').waitFor({ state: 'visible' });
  const restante = ((await texto(real.locator('#timeout-tempo'))) ?? '0:00').split(':').map(Number);
  ok(restante[0] === 0 && restante[1] >= 30 && restante[1] <= 40, `time-out: ao recarregar a página o minuto continua (0:${restante[1]})`);
  ok(await esperarPor(async () => ((await real.locator('#faixa-timeout').textContent()) ?? '').includes('Leões do Sul')), 'time-out: depois de recarregar a faixa lembra que equipa pediu');
  await real.close();
});

// ======================= Sistema defensivo do adversário =======================
await passo('Sistema defensivo: o banco marca a defesa do adversário e ela segue com os remates posicionais', async () => {
  const [{ id: jogoId }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [aguias.id, leoes.id, donoId]);
  const banco = await pagina(`/banco.html?jogo=${jogoId}`);
  await banco.waitForSelector('.botao-jogador');
  const sistema = async () => (await banco.locator('#sistemas button.ativo').evaluateAll((bs) => bs.map((b) => b.textContent)));
  const nRemates = async () => (await q("SELECT 1 FROM eventos WHERE jogo_id = $1 AND tipo_evento_codigo = 'REMATE'", [jogoId])).length;
  const ultimo = async () => (await q("SELECT resultado, situacao, sistema_defensivo FROM eventos WHERE jogo_id = $1 AND tipo_evento_codigo = 'REMATE' ORDER BY id DESC LIMIT 1", [jogoId]))[0];
  const caixa = await banco.locator('#campo').boundingBox();
  // um remate da equipa que ataca: toca no mapa, escolhe o 1.º jogador e o resultado
  const remate = async (resultado, situacao = null) => {
    if (situacao) await banco.locator('#situacoes button', { hasText: situacao }).click();
    if (situacao !== '7 metros') await banco.locator('#campo').click({ position: { x: caixa.width * 0.5, y: caixa.height * 0.5 } });
    await banco.locator('.botao-jogador').first().click();
    if (resultado === 'GOLO') await golo(banco, 'MEIO_CENTRO');
    else await banco.click(`.botao-resultado[data-resultado="${resultado}"]`);
  };
  const esperarRemates = async (n) => esperarPor(async () => (await nRemates()) === n);

  ok((await banco.locator('#rotulo-sistema').textContent()) === 'Defesa do adversário', 'sistema defensivo: o banco tem a linha «Defesa do adversário»');
  ok((await banco.locator('#sistemas button').evaluateAll((bs) => bs.map((b) => b.textContent))).join('|') === '6:0|5:1|3:2:1|4:2|Individual', 'sistema defensivo: 6:0, 5:1, 3:2:1, 4:2 e individual');
  ok((await sistema()).length === 0, 'sistema defensivo: começa sem nenhuma defesa escolhida');

  // sem defesa escolhida o remate fica sem sistema
  await remate('FORA');
  ok(await esperarRemates(1) && (await ultimo()).sistema_defensivo === null, 'sistema defensivo: sem defesa escolhida o remate fica sem sistema');

  // escolher a 5:1: fica marcada e segue com o remate posicional
  await banco.locator('#sistemas button', { hasText: '5:1' }).click();
  ok((await sistema()).join() === '5:1' && (await banco.locator('#sistemas button[data-sistema="5_1"]').getAttribute('aria-pressed')) === 'true', 'sistema defensivo: a 5:1 fica marcada');
  await remate('FORA');
  ok(await esperarRemates(2) && (await ultimo()).sistema_defensivo === '5_1', 'sistema defensivo: o remate posicional leva a 5:1');
  await captura(banco, 'banco-sistema-defensivo');

  // a defesa fica escolhida para os remates seguintes (não é preciso voltar a tocar)
  await remate('GOLO');
  ok(await esperarRemates(3) && (await ultimo()).sistema_defensivo === '5_1' && (await ultimo()).resultado === 'GOLO', 'sistema defensivo: continua escolhida no remate seguinte (um golo, com a janela da baliza)');

  // contra-ataque e 7 metros não enfrentam uma defesa montada: não levam sistema
  await remate('FORA', 'Contra-ataque');
  ok(await esperarRemates(4) && (await ultimo()).situacao === 'CONTRA_ATAQUE' && (await ultimo()).sistema_defensivo === null, 'sistema defensivo: o contra-ataque não leva sistema');
  await remate('FORA', '7 metros');
  ok(await esperarRemates(5) && (await ultimo()).situacao === 'SETE_METROS' && (await ultimo()).sistema_defensivo === null, 'sistema defensivo: os 7 metros não levam sistema');
  ok((await sistema()).join() === '5:1', 'sistema defensivo: depois deles a 5:1 continua escolhida');

  // cada equipa tem a sua defesa: a do adversário de quem ataca
  await banco.locator('#seletor-equipa button').nth(1).click();
  ok((await sistema()).length === 0, 'sistema defensivo: a outra equipa (que ataca contra a defesa das Águias) começa sem defesa');
  await banco.locator('#sistemas button', { hasText: 'Individual' }).click();
  await banco.locator('#seletor-equipa button').nth(0).click();
  ok((await sistema()).join() === '5:1', 'sistema defensivo: ao voltar à equipa da casa a 5:1 continua lá');

  // recarregar a página não a perde
  await banco.reload({ waitUntil: 'domcontentloaded' });
  await banco.waitForSelector('.botao-jogador');
  ok((await sistema()).join() === '5:1', 'sistema defensivo: recarregar a página não perde a defesa escolhida');
  await banco.locator('#seletor-equipa button').nth(1).click();
  ok((await sistema()).join() === 'Individual', 'sistema defensivo: nem a da outra equipa');
  await banco.locator('#seletor-equipa button').nth(0).click();

  // tocar outra vez na escolhida tira-a
  await banco.locator('#sistemas button', { hasText: '5:1' }).click();
  ok((await sistema()).length === 0, 'sistema defensivo: tocar outra vez na defesa escolhida tira-a');
  await remate('FORA');
  ok(await esperarRemates(6) && (await ultimo()).sistema_defensivo === null, 'sistema defensivo: depois de a tirar o remate fica sem sistema');

  await banco.close();
});

await passo('Dashboard: contra que defesa se marca mais e o livro dos 7 metros', async () => {
  const [{ id: jogoId }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [aguias.id, leoes.id, donoId]);
  const [jogA, jogB] = await q("SELECT id, numero, nome FROM jogadores WHERE equipa_id = $1 AND posicao_codigo <> 'GR' ORDER BY numero LIMIT 2", [aguias.id]);
  const [{ id: jogFora }] = await q("SELECT id FROM jogadores WHERE equipa_id = $1 AND posicao_codigo <> 'GR' ORDER BY numero LIMIT 1", [leoes.id]);
  let segundo = 0;
  const evento = (equipa, jogador, resultado, { situacao = 'POSICIONAL', sistema = null, baliza = null } = {}) => q(
    `INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, resultado, situacao, x, y, parte, segundo_jogo, baliza_x, baliza_y, sistema_defensivo)
     VALUES ($1, $2, 'REMATE', $3, $4, $5, 50, 40, 1, $6, $7, $8, $9)`,
    [jogoId, equipa, jogador, resultado, situacao, (segundo += 30), baliza?.[0] ?? null, baliza?.[1] ?? null, sistema]);
  // Águias contra a 6:0: 1 golo em 4 (25 %); contra a 5:1: 3 em 4 (75 %); e um golo sem defesa marcada
  for (const r of ['GOLO', 'FORA', 'FORA', 'DEFESA']) await evento(aguias.id, jogA.id, r, { sistema: '6_0' });
  for (const r of ['GOLO', 'GOLO', 'GOLO', 'POSTE']) await evento(aguias.id, jogB.id, r, { sistema: '5_1' });
  await evento(aguias.id, jogA.id, 'GOLO');
  // 7 metros do jogador A: 2 golos e 1 defesa em baixo à direita, 1 fora; do B: 1 golo em cima à esquerda (não contam como defesa montada)
  await evento(aguias.id, jogA.id, 'GOLO', { situacao: 'SETE_METROS', baliza: [90, 90] });
  await evento(aguias.id, jogA.id, 'GOLO', { situacao: 'SETE_METROS', baliza: [85, 80] });
  await evento(aguias.id, jogA.id, 'DEFESA', { situacao: 'SETE_METROS', baliza: [88, 92] });
  await evento(aguias.id, jogA.id, 'FORA', { situacao: 'SETE_METROS' });
  await evento(aguias.id, jogB.id, 'GOLO', { situacao: 'SETE_METROS', baliza: [10, 10] });
  await evento(leoes.id, jogFora, 'GOLO', { sistema: '6_0' });
  ok((await q("SELECT 1 FROM v_remates WHERE jogo_id = $1 AND sistema_defensivo IS NOT NULL", [jogoId])).length === 9, 'dashboard: a vista dos remates traz o sistema defensivo (9 remates com defesa marcada)');

  const dash = await pagina(`/dashboard.html?jogo=${jogoId}`);
  await dash.waitForSelector('#painel .cartao');
  const cartaoDefesa = dash.locator('section.cartao', { has: dash.locator('h2', { hasText: 'Contra que defesa' }) });
  const cartaoLivro = dash.locator('section.cartao', { has: dash.locator('h2', { hasText: 'Livro dos 7 metros' }) });
  const linha = (sistema) => cartaoDefesa.locator(`tr[data-sistema="${sistema}"]`);

  ok(((await cartaoDefesa.locator('h2').textContent()) ?? '').includes('Águias do Norte'), 'dashboard: «Contra que defesa» é da equipa escolhida');
  ok((await cartaoDefesa.locator('tbody tr').count()) === 3, 'dashboard: três linhas (6:0, 5:1 e sem defesa marcada)');
  ok((await texto(linha('6_0'))).startsWith('Defesa6:0') && (await linha('6_0').locator('td.num').allTextContents()).join('|') === '4|1|25%', `dashboard: contra a 6:0 marcam 1 de 4 (25%) (${await linha('6_0').textContent()})`);
  ok((await linha('5_1').locator('td.num').allTextContents()).join('|') === '4|3|75%', 'dashboard: contra a 5:1 marcam 3 de 4 (75%)');
  ok((await linha('NENHUM').locator('td').first().textContent()) === 'Sem defesa marcada' && (await linha('NENHUM').locator('td.num').first().textContent()) === '1', 'dashboard: o remate sem defesa marcada fica à parte');
  ok((await cartaoDefesa.locator('tr.melhor[data-sistema="5_1"]').count()) === 1 && (await cartaoDefesa.locator('tr.pior[data-sistema="6_0"]').count()) === 1, 'dashboard: a 5:1 é a melhor e a 6:0 a pior');
  const resumoDefesa = (await cartaoDefesa.locator('.zona-top').textContent()) ?? '';
  ok(resumoDefesa.includes('Marca mais contra a defesa 5:1') && resumoDefesa.includes('menos contra a 6:0'), `dashboard: o resumo diz contra que defesa marcam mais e menos (${resumoDefesa})`);
  ok(((await cartaoDefesa.textContent()) ?? '').includes('contra-ataque e nos 7 metros não há defesa montada'), 'dashboard: o quadro avisa que só conta o ataque posicional');
  ok((await cartaoDefesa.locator('tbody td').allTextContents()).every((t) => !/7 metros/.test(t)), 'dashboard: os 7 metros não entram na comparação');

  // livro dos 7 metros das Águias
  ok(((await cartaoLivro.locator('h2').textContent()) ?? '').includes('Águias do Norte'), 'livro: é da equipa escolhida');
  ok((await cartaoLivro.locator('.lancador').count()) === 2, 'livro: dois lançadores');
  const ficha = cartaoLivro.locator('.lancador').first();
  const textoFicha = (await ficha.textContent()) ?? '';
  ok(textoFicha.includes(`#${jogA.numero} ${jogA.nome}`) && textoFicha.includes('4 lançamentos · 2 golos · 1 defendido') && textoFicha.includes('1 sem defesa'),
    `livro: o que mais lançou vem primeiro, com os números (${textoFicha})`);
  ok((await ficha.locator('.zona-top').textContent())?.includes('baixo à direita') && (await ficha.locator('.zona-top').textContent())?.includes('3 de 3'), 'livro: a tendência é baixo à direita (3 de 3)');
  ok((await texto(ficha.locator('.baliza-zona[data-zona="BAIXO_DIR"] + .baliza-contagem'))) === '3', 'livro: a baliza do jogador tem 3 em baixo à direita');
  const segunda = cartaoLivro.locator('.lancador').nth(1);
  ok(((await segunda.textContent()) ?? '').includes('1 lançamento · 1 golo · 0 defendidos') && ((await segunda.textContent()) ?? '').includes('Ainda sem zona preferida'), 'livro: com 1 lançamento ainda não há zona preferida');
  ok(((await cartaoLivro.textContent()) ?? '').includes('Total: 5 lançamentos, 3 golos (60%)'), 'livro: o total da equipa (5 lançamentos, 3 golos, 60%)');
  await captura(dash, 'dashboard-livro-7-metros');

  // a outra equipa: uma defesa só e sem 7 metros
  await dash.locator('.separador-abas button', { hasText: 'Leões do Sul' }).click();
  ok((await cartaoDefesa.locator('tbody tr').count()) === 1 && (await cartaoDefesa.locator('tr.melhor, tr.pior').count()) === 0, 'dashboard: a outra equipa tem uma defesa só e não há melhor nem pior');
  ok(((await cartaoDefesa.textContent()) ?? '').includes('Para comparar são precisas pelo menos duas defesas'), 'dashboard: com uma defesa só explica o que falta para comparar');
  ok(((await cartaoLivro.textContent()) ?? '').includes('Ainda sem 7 metros'), 'livro: a equipa sem 7 metros diz que o livro ainda está vazio');
  await dash.close();

  // um jogo sem remates
  const [{ id: vazioId }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [aguias.id, leoes.id, donoId]);
  const vazio = await pagina(`/dashboard.html?jogo=${vazioId}`);
  await vazio.waitForSelector('#painel .cartao');
  const textoVazio = (await vazio.locator('#painel').textContent()) ?? '';
  ok(textoVazio.includes('Ainda sem remates em ataque posicional.') && textoVazio.includes('Ainda sem 7 metros'), 'dashboard: sem remates os dois quadros explicam que ainda não há dados');
  await vazio.close();

  // jogo com remates posicionais mas sem a defesa marcada
  const [{ id: semId }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [aguias.id, leoes.id, donoId]);
  await q("INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, resultado, x, y, parte, segundo_jogo) VALUES ($1, $2, 'REMATE', $3, 'GOLO', 50, 40, 1, 30)", [semId, aguias.id, jogA.id]);
  const sem = await pagina(`/dashboard.html?jogo=${semId}`);
  await sem.waitForSelector('#painel .cartao');
  ok((((await sem.locator('#painel').textContent()) ?? '').includes('Ainda sem a defesa do adversário marcada')), 'dashboard: sem defesa marcada o quadro explica como a marcar no banco');
  await sem.close();
});

// ======================= Relatório do intervalo =======================
await passo('Relatório do intervalo: os pontos a corrigir e a manter na 2.ª parte, para ver, copiar e imprimir', async () => {
  const NOME_AGUIAS = 'Águias do Norte';
  const NOME_LEOES = 'Leões do Sul';
  const [{ id: jogoId }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [aguias.id, leoes.id, donoId]);
  const [jogA, jogB] = await q("SELECT id, numero, nome FROM jogadores WHERE equipa_id = $1 AND posicao_codigo <> 'GR' ORDER BY numero LIMIT 2", [aguias.id]);
  const [jogF] = await q("SELECT id, numero, nome FROM jogadores WHERE equipa_id = $1 AND posicao_codigo <> 'GR' ORDER BY numero LIMIT 1", [leoes.id]);
  let segundo = 0;
  const remate = (equipa, jogador, resultado, parte = 1) => q(
    `INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, resultado, situacao, x, y, parte, segundo_jogo)
     VALUES ($1, $2, 'REMATE', $3, $4, 'POSICIONAL', 50, 40, $5, $6)`, [jogoId, equipa, jogador, resultado, parte, (segundo += 20)]);
  // 1.ª parte. Águias: o jogador A falha (1 golo em 7), o B marca (4 em 5); o jogador dos Leões marca 4 em 5 e já levou 2 exclusões
  for (const r of ['GOLO', 'FORA', 'FORA', 'FORA', 'DEFESA', 'DEFESA', 'DEFESA']) await remate(aguias.id, jogA.id, r);
  for (const r of ['GOLO', 'GOLO', 'GOLO', 'GOLO', 'FORA']) await remate(aguias.id, jogB.id, r);
  for (const r of ['GOLO', 'GOLO', 'GOLO', 'GOLO', 'FORA']) await remate(leoes.id, jogF.id, r);
  await q("INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, parte, segundo_jogo) VALUES ($1, $2, 'DOIS_MINUTOS', $3, 1, 300), ($1, $2, 'DOIS_MINUTOS', $3, 1, 900)", [jogoId, aguias.id, jogA.id]);
  // 2.ª parte: um golo dos Leões (não conta nos números do intervalo)
  await remate(leoes.id, jogF.id, 'GOLO', 2);
  ok((await q('SELECT 1 FROM v_remates WHERE jogo_id = $1 AND parte = 1 AND corredor IS NOT NULL AND distancia IS NOT NULL', [jogoId])).length === 17, 'intervalo: a vista dos remates traz a parte, o corredor e a distância');

  // O botão do dashboard abre o relatório da equipa que se está a ver (o dono leva o código do jogo)
  const [{ codigo: codigoJogo }] = await q('SELECT codigo FROM jogos WHERE id = $1', [jogoId]);
  const dash = await pagina(`/dashboard.html?jogo=${jogoId}`);
  await dash.waitForSelector('#painel .cartao');
  ok((await dash.locator('#intervalo').getAttribute('href')) === `intervalo.html?jogo=${jogoId}&c=${codigoJogo}&equipa=${aguias.id}`, 'intervalo: o botão do dashboard leva a equipa escolhida');
  await dash.locator('.separador-abas button', { hasText: NOME_LEOES }).click();
  ok((await dash.locator('#intervalo').getAttribute('href')) === `intervalo.html?jogo=${jogoId}&c=${codigoJogo}&equipa=${leoes.id}`, 'intervalo: o botão acompanha a equipa escolhida no dashboard');
  await dash.locator('.separador-abas button', { hasText: NOME_AGUIAS }).click();
  await Promise.all([dash.waitForURL(/intervalo\.html/), dash.locator('#intervalo').click()]);
  await dash.waitForSelector('.folha');

  // A folha das Águias
  const p = dash;
  const golos = async () => (await p.locator('.folha-placar strong').allTextContents()).join('-');
  const pontos = (tipo) => p.locator(`.pontos.${tipo} li`);
  const titulos = (tipo) => p.locator(`.pontos.${tipo} li strong`).allTextContents();
  ok((await golos()) === '5-4', `intervalo: o resultado é o da 1.ª parte, sem o golo da 2.ª (${await golos()})`);
  ok((await p.title()).startsWith('Intervalo 5–4'), `intervalo: o título do separador leva o resultado (${await p.title()})`);
  ok(((await p.locator('.folha-sub').textContent()) ?? '') === `Intervalo · relatório da 1.ª parte para ${NOME_AGUIAS}`, 'intervalo: diz de que equipa é o relatório');
  ok((await p.locator('.aviso-inline').count()) === 0, 'intervalo: com remates que cheguem não há aviso');
  ok((await pontos('corrigir').count()) === 3, 'intervalo: três pontos a corrigir');
  const corrigir = await titulos('corrigir');
  ok(corrigir[0] === `Cuidado com o #${jogA.numero} ${jogA.nome}` && corrigir[1] === `Rever o #${jogA.numero} ${jogA.nome}` && corrigir[2] === `Marcar o #${jogF.numero} ${jogF.nome}`,
    `intervalo: por gravidade, o risco de expulsão, o jogador a falhar e o do adversário (${corrigir})`);
  ok(((await pontos('corrigir').nth(1).textContent()) ?? '').includes('1 golo em 7 remates (3 fora, 3 defendidos)'), 'intervalo: o ponto diz o que correu mal');
  ok((await pontos('manter').count()) === 1 && (await titulos('manter'))[0] === `Procurar o #${jogB.numero} ${jogB.nome}`, 'intervalo: um ponto a manter (o jogador em forma)');

  const numeros = await p.locator('table.numeros-intervalo tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent)));
  const linhaNumeros = (rotulo) => numeros.find((l) => l[0] === rotulo)?.slice(1).join('|');
  ok(linhaNumeros('Golos') === '5|4' && linhaNumeros('Remates') === '12|5' && linhaNumeros('Eficácia') === '42%|80%', `intervalo: golos, remates e eficácia da 1.ª parte (${JSON.stringify(numeros)})`);
  ok(await p.locator('table.numeros-intervalo tbody tr').first().locator('td').nth(1).evaluate((td) => td.classList.contains('vantagem')), 'intervalo: a equipa que está melhor numa linha fica destacada');
  ok((await p.locator('.folha-bloco', { has: p.locator('h2', { hasText: `Remates de ${NOME_AGUIAS}` }) }).locator('tbody tr').count()) === 2, 'intervalo: os dois jogadores que rematam');
  await captura(p, 'intervalo');

  // Copiar como texto
  await p.click('#copiar');
  const copiado = await p.evaluate(() => navigator.clipboard.readText());
  const linhasCopiadas = copiado.split('\n');
  ok(linhasCopiadas[0] === `Intervalo · ${NOME_AGUIAS} 5–4 ${NOME_LEOES}` && linhasCopiadas[1] === `Relatório da 1.ª parte, para ${NOME_AGUIAS}`, `intervalo: o texto copiado começa pelo resultado (${linhasCopiadas.slice(0, 2)})`);
  ok(copiado.includes(`1. Cuidado com o #${jogA.numero} ${jogA.nome}: Já tem 2 exclusões de 2 minutos`) && copiado.includes('A manter:') && copiado.includes('Golos: 5 – 4'), 'intervalo: o texto copiado leva os pontos e os números');
  ok(((await p.locator('#aviso').textContent()) ?? '').includes('Texto copiado'), 'intervalo: avisa que o texto foi copiado');

  // Imprimir: só a folha
  await p.emulateMedia({ media: 'print' });
  ok(await p.locator('.topo').isHidden() && await p.locator('.separador-abas').isHidden() && await p.locator('.folha').isVisible(), 'intervalo: ao imprimir só fica a folha (sem cabeçalho nem botões)');
  await p.emulateMedia({ media: 'screen' });

  // A outra equipa, e a 2.ª parte
  await p.locator('.separador-abas button', { hasText: `Para: ${NOME_LEOES}` }).click();
  ok(((await p.locator('.folha-sub').textContent()) ?? '').endsWith(`para ${NOME_LEOES}`), 'intervalo: o relatório muda para a outra equipa');
  const numerosLeoes = await p.locator('table.numeros-intervalo tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent)));
  ok(numerosLeoes.find((l) => l[0] === 'Golos')?.slice(1).join('|') === '4|5', 'intervalo: do lado dos Leões os golos são 4 contra 5');
  ok(((await pontos('corrigir').first().textContent()) ?? '').includes(`Marcar o #${jogB.numero} ${jogB.nome}`), 'intervalo: os Leões veem quem têm de marcar nas Águias');
  await p.locator('.separador-abas button', { hasText: '2.ª parte' }).click();
  ok(((await p.locator('.folha-sub').textContent()) ?? '') === `Relatório da 2.ª parte para ${NOME_LEOES}` && (await golos()) === '0-1', 'intervalo: a 2.ª parte tem os seus números');
  ok(((await p.locator('.aviso-inline').textContent()) ?? '') === 'Só 1 remate registado nesta parte: os pontos podem enganar.', 'intervalo: com poucos remates avisa que os pontos podem enganar');
  await p.close();

  // O link de partilha também abre o relatório (sem conta), do lado da casa
  const visitante = await pagina(`/intervalo.html?jogo=${jogoId}&c=${codigoJogo}`, { contexto: ctxVisitante, tolerar: ['401'] });
  await visitante.waitForSelector('.folha');
  ok(((await visitante.locator('.folha-sub').textContent()) ?? '').endsWith(`para ${NOME_AGUIAS}`) && (await visitante.locator('.pontos.corrigir li').count()) === 3, 'intervalo: quem só tem a ligação vê o relatório');
  ok((await visitante.locator('#voltar').getAttribute('href')) === `dashboard.html?jogo=${jogoId}&c=${codigoJogo}`, 'intervalo: a seta volta ao dashboard do mesmo jogo');
  await visitante.close();
  // (um jogo de há mais de 24 horas, como o jogo 2, só abre com o código; os de hoje estão abertos a convidados)
  const semCodigo = await pagina('/intervalo.html?jogo=2', { contexto: ctxVisitante, tolerar: ['401', '404'] });
  ok(await esperarPor(async () => (await semCodigo.locator('.sem-acesso').count()) === 1) && (await semCodigo.locator('#ligacao').textContent()) === 'sem acesso' && (await semCodigo.locator('#copiar').isHidden()),
    'intervalo: sem a ligação, um jogo antigo não está disponível (e não há botões para copiar nem imprimir)');
  ok((await semCodigo.locator('.sem-acesso a[href^="entrar.html?voltar="]').count()) === 1, 'intervalo: sem acesso oferece entrar na conta');
  await semCodigo.close();

  // Um jogo ainda sem remates
  const [{ id: vazioId }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [aguias.id, leoes.id, donoId]);
  const vazio = await pagina(`/intervalo.html?jogo=${vazioId}`);
  await vazio.waitForSelector('.folha');
  ok(((await vazio.locator('.aviso-inline').textContent()) ?? '') === 'Ainda sem remates registados nesta parte.' && ((await vazio.locator('.folha-bloco .vazio').textContent()) ?? '').includes('Ainda não há remates que cheguem'),
    'intervalo: sem remates diz que ainda não há dados em vez de elogiar');
  ok((await vazio.locator('.pontos').count()) === 0 && (await vazio.locator('.folha-placar strong').allTextContents()).join('-') === '0-0', 'intervalo: sem remates não há pontos e o resultado é 0–0');
  await vazio.close();
});

await passo('Superioridade: a eficácia por situação (igualdade, superioridade, inferioridade, 7×6) no dashboard', async () => {
  const [{ id: jogoId }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [aguias.id, leoes.id, donoId]);
  const [{ id: jogCasa }] = await q("SELECT id FROM jogadores WHERE equipa_id = $1 AND posicao_codigo <> 'GR' ORDER BY numero LIMIT 1", [aguias.id]);
  const [{ id: jogFora }] = await q("SELECT id FROM jogadores WHERE equipa_id = $1 AND posicao_codigo <> 'GR' ORDER BY numero LIMIT 1", [leoes.id]);
  const evento = (tipo, equipa, jogador, segundo, resultado = null, situacao = 'POSICIONAL') => q(
    `INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, resultado, situacao, x, y, parte, segundo_jogo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [jogoId, equipa, tipo, jogador, resultado, situacao, resultado ? 50 : null, resultado ? 40 : null, segundo >= 1800 ? 2 : 1, segundo]);
  // Casa com 2 minutos aos 10:00 (até 12:00); fora com vermelho aos 11:40 (até 13:40); ataque 7×6 do fora entre 15:00 e 15:50
  await evento('REMATE', aguias.id, jogCasa, 300, 'GOLO');                         // igualdade
  await evento('DOIS_MINUTOS', aguias.id, jogCasa, 600);
  await evento('REMATE', leoes.id, jogFora, 650, 'GOLO');                          // fora em superioridade
  await evento('REMATE', leoes.id, jogFora, 660, 'DEFESA');                        // fora em superioridade
  await evento('VERMELHO', leoes.id, jogFora, 700);
  await evento('REMATE', aguias.id, jogCasa, 710, 'FORA');                         // uma a menos de cada lado: igualdade
  await evento('REMATE', aguias.id, jogCasa, 750, 'GOLO');                         // casa em superioridade
  await evento('REMATE', aguias.id, jogCasa, 780, 'GOLO');                         // casa em superioridade
  await evento('REMATE', aguias.id, jogCasa, 790, 'GOLO', 'SETE_METROS');          // os 7 metros ficam de fora
  await evento('SETE_SEIS_INICIO', leoes.id, null, 900);
  await evento('REMATE', aguias.id, jogCasa, 910, 'GOLO');                         // baliza vazia
  await evento('REMATE', leoes.id, jogFora, 920, 'DEFESA');                        // fora em 7×6
  await evento('SETE_SEIS_FIM', leoes.id, null, 950);
  await q('INSERT INTO relogios_jogo (jogo_id, segundo, a_correr) VALUES ($1, 1000, FALSE)', [jogoId]);

  const dash = await pagina(`/dashboard.html?jogo=${jogoId}`);
  const cartaoNumerica = dash.locator('section.cartao', { has: dash.locator('h2', { hasText: 'Superioridade numérica' }) });
  await cartaoNumerica.waitFor();
  const linha = async (situacao) => (await cartaoNumerica.locator(`tr[data-situacao="${situacao}"] td`).allTextContents()).map((t) => t.trim()).slice(1);

  ok((await cartaoNumerica.locator('h2').textContent()).includes('Águias do Norte'), 'eficácia numérica: o quadro é da equipa escolhida (a da casa)');
  ok((await cartaoNumerica.locator('tbody tr').count()) === 5, 'eficácia numérica: cinco situações (superioridade, igualdade, inferioridade, 7×6, baliza vazia)');
  // colunas: Rem., Golos, %, Sofr., Tempo
  ok(JSON.stringify(await linha('SUPERIORIDADE')) === JSON.stringify(['2', '2', '100%', '0', '01:40']), `eficácia numérica: casa em superioridade 2 remates, 2 golos, 0 sofridos, 1:40 (${await linha('SUPERIORIDADE')})`);
  ok(JSON.stringify(await linha('IGUALDADE')) === JSON.stringify(['2', '1', '50%', '0', '–']), `eficácia numérica: casa em igualdade 2 remates, 1 golo (${await linha('IGUALDADE')})`);
  ok(JSON.stringify(await linha('INFERIORIDADE')) === JSON.stringify(['–', '–', '–', '1', '01:40']), `eficácia numérica: casa em inferioridade sem remates, 1 golo sofrido, 1:40 (${await linha('INFERIORIDADE')})`);
  ok(JSON.stringify(await linha('SETE_SEIS')) === JSON.stringify(['–', '–', '–', '–', '–']), `eficácia numérica: a casa não atacou em 7×6 (${await linha('SETE_SEIS')})`);
  ok(JSON.stringify(await linha('BALIZA_VAZIA')) === JSON.stringify(['1', '1', '100%', '0', '00:50']), `eficácia numérica: casa marcou na baliza vazia do adversário durante os 50 s do 7×6 dele (${await linha('BALIZA_VAZIA')})`);
  ok(((await cartaoNumerica.textContent()) ?? '').includes('Sem os 7 metros'), 'eficácia numérica: o quadro avisa que os 7 metros ficam de fora');
  ok(await dash.locator('#relogio-dash.parado').isVisible() && (await texto(dash.locator('#relogio-dash'))) === '16:40', 'eficácia numérica: o relógio parado do jogo está nos 16:40');
  ok(await dash.locator('#painel .faixa-numerica').isHidden(), 'eficácia numérica: aos 16:40 já não há ninguém a menos nem 7×6: a faixa está escondida');
  await captura(dash, 'dashboard-eficacia-numerica');

  // A outra equipa: o espelho
  await dash.click('.separador-abas button:has-text("Ver: Leões do Sul")');
  await esperarPor(async () => (await cartaoNumerica.locator('h2').textContent()).includes('Leões do Sul'));
  ok(JSON.stringify(await linha('SUPERIORIDADE')) === JSON.stringify(['2', '1', '50%', '0', '01:40']), `eficácia numérica: fora em superioridade 2 remates, 1 golo (${await linha('SUPERIORIDADE')})`);
  ok(JSON.stringify(await linha('INFERIORIDADE')) === JSON.stringify(['–', '–', '–', '2', '01:40']), `eficácia numérica: fora em inferioridade sofreu 2 golos (${await linha('INFERIORIDADE')})`);
  ok(JSON.stringify(await linha('SETE_SEIS')) === JSON.stringify(['1', '0', '0%', '1', '00:50']), `eficácia numérica: fora em 7×6 rematou uma vez, sofreu 1 golo na baliza vazia, 50 s (${await linha('SETE_SEIS')})`);
  ok(JSON.stringify(await linha('BALIZA_VAZIA')) === JSON.stringify(['–', '–', '–', '–', '–']), `eficácia numérica: fora não rematou contra baliza vazia (${await linha('BALIZA_VAZIA')})`);
  await dash.close();

  // Sem relógio usado (tudo a 00:00) não se inventa nada
  const [{ id: jogoSemRelogio }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [aguias.id, leoes.id, donoId]);
  await q("INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, parte, segundo_jogo) VALUES ($1, $2, 'DOIS_MINUTOS', $3, 1, 0)", [jogoSemRelogio, aguias.id, jogCasa]);
  const banco = await pagina(`/banco.html?jogo=${jogoSemRelogio}`);
  await banco.waitForSelector('.botao-jogador');
  ok(await banco.locator('#faixa-numerica').isHidden(), 'sem relógio: o banco não inventa uma superioridade com o relógio a 00:00');
  await banco.close();
  const semRelogio = await pagina(`/dashboard.html?jogo=${jogoSemRelogio}`);
  const aviso = semRelogio.locator('section.cartao', { has: semRelogio.locator('h2', { hasText: 'Superioridade numérica' }) });
  await aviso.waitFor();
  ok((await aviso.textContent()).includes('relógio do banco não foi usado') && (await aviso.locator('table').count()) === 0, 'sem relógio: o dashboard explica porque não há eficácia por situação');
  ok(await semRelogio.locator('#relogio-dash').isHidden(), 'sem relógio: o dashboard não mostra o relógio');
  await semRelogio.close();
});

// ======================= Treinador-assistente =======================
await passo('Treinador-assistente: sugestões ao dono do jogo (time-out, sanções, jogadores) e nada para quem vê pelo link', async () => {
  const [{ id: jogoId, codigo }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id, codigo', [aguias.id, leoes.id, donoId]);
  const [{ id: jogCasa }] = await q("SELECT id FROM jogadores WHERE equipa_id = $1 AND posicao_codigo <> 'GR' ORDER BY numero LIMIT 1", [aguias.id]);
  const [{ id: jogFora }] = await q("SELECT id FROM jogadores WHERE equipa_id = $1 AND posicao_codigo <> 'GR' ORDER BY numero LIMIT 1", [leoes.id]);
  const evento = (tipo, equipa, jogador, segundo, resultado = null) => q(
    `INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, resultado, situacao, x, y, parte, segundo_jogo)
     VALUES ($1, $2, $3, $4, $5, 'POSICIONAL', $6, $7, 1, $8)`,
    [jogoId, equipa, tipo, jogador, resultado, resultado ? 50 : null, resultado ? 40 : null, segundo]);

  // Quatro golos seguidos do #fora nos últimos minutos (4 golos em 5 remates); o #casa falha 5 remates e leva dois 2 minutos
  await evento('DOIS_MINUTOS', aguias.id, jogCasa, 400);
  await evento('DOIS_MINUTOS', aguias.id, jogCasa, 450);
  for (const segundo of [500, 540, 580, 620, 660]) await evento('REMATE', aguias.id, jogCasa, segundo, 'FORA');
  await evento('REMATE', leoes.id, jogFora, 780, 'DEFESA');
  for (const segundo of [800, 840, 880, 920]) await evento('REMATE', leoes.id, jogFora, segundo, 'GOLO');
  await q('INSERT INTO relogios_jogo (jogo_id, segundo, a_correr) VALUES ($1, 1000, FALSE)', [jogoId]);

  const dash = await pagina(`/dashboard.html?jogo=${jogoId}`);
  const painel = dash.locator('section.assistente');
  await painel.waitFor();
  const sugestao = (codigoRegra) => painel.locator(`li.sugestao[data-codigo="${codigoRegra}"]`);
  const conteudo = async (locator) => ((await locator.textContent()) ?? '').replace(/\s+/g, ' ').trim();

  ok(await sugestao('TIMEOUT').count() === 1 && (await sugestao('TIMEOUT').getAttribute('data-nivel')) === 'urgente', 'assistente: série de golos do adversário -> time-out urgente');
  const textoTimeout = await conteudo(sugestao('TIMEOUT'));
  ok(textoTimeout.includes('Time-out: Águias do Norte') && textoTimeout.includes('Leões do Sul marcou 4 golos seguidos') && textoTimeout.includes('Restam 2 time-outs'),
    `assistente: o time-out explica porquê e quantos restam (${textoTimeout})`);
  ok(await sugestao('SANCAO').count() === 1 && (await conteudo(sugestao('SANCAO'))).includes('à beira da expulsão'), 'assistente: avisa quem já tem dois 2 minutos');
  ok(await sugestao('MARCAR_JOGADOR').count() === 1 && (await conteudo(sugestao('MARCAR_JOGADOR'))).includes('4 golos em 5 remates (80%)'),
    'assistente: o jogador em chamas do adversário é para marcar de perto, com os números');
  ok(await sugestao('REVER_JOGADOR').count() === 1 && (await conteudo(sugestao('REVER_JOGADOR'))).includes('0 golos em 5 remates (0%)'),
    'assistente: o jogador que só falha é para rever, com os números');
  const ordem = await painel.locator('li.sugestao').evaluateAll((lis) => lis.map((li) => li.dataset.codigo));
  ok(ordem[0] === 'TIMEOUT' && ordem[1] === 'SANCAO', `assistente: as sugestões mais importantes vêm primeiro (${ordem})`);
  const linhaTimeouts = await conteudo(painel.locator('.timeouts'));
  ok(linhaTimeouts.includes('Águias do Norte 0/3 usados · pode pedir 2') && linhaTimeouts.includes('Leões do Sul 0/3 usados · pode pedir 2'), `assistente: mostra os time-outs de cada equipa (${linhaTimeouts})`);
  ok((await dash.locator('.alerta-parcial').count()) === 0, 'assistente: o aviso antigo do parcial foi substituído pelo painel');
  await captura(dash, 'dashboard-assistente');

  // Quem vê o jogo só pelo link não tem o treinador-assistente
  const visitante = await pagina(`/dashboard.html?jogo=${jogoId}&c=${codigo}`, { contexto: ctxVisitante, tolerar: ['401'] });
  await visitante.waitForSelector('#painel .cartao');
  ok((await visitante.locator('section.assistente').count()) === 0, 'assistente: quem vê pelo link (sem conta) não tem o painel do treinador');
  ok((await visitante.locator('#painel .cartao').count()) > 3, 'assistente: o resto do dashboard continua igual para quem vê pelo link');
  await visitante.close();

  // Pedir time-out no banco: a série zera e os direitos baixam
  const banco = await pagina(`/banco.html?jogo=${jogoId}`);
  await banco.waitForSelector('.botao-jogador');
  await banco.locator('#outros button', { hasText: /^Time-out$/ }).click();
  ok(await esperarPor(async () => (await q("SELECT 1 FROM eventos WHERE jogo_id = $1 AND tipo_evento_codigo = 'TIMEOUT'", [jogoId])).length === 1), 'assistente: o banco registou o time-out da equipa da casa');
  await empurrar(dash, jogoId);
  ok(await esperarPor(async () => (await sugestao('TIMEOUT').count()) === 0), 'assistente: depois do time-out a sugestão desaparece');
  ok(await esperarPor(async () => (await conteudo(painel.locator('.timeouts'))).includes('Águias do Norte 1/3 usados · pode pedir 1')), 'assistente: o painel conta o time-out usado');
  ok(await sugestao('SANCAO').count() === 1, 'assistente: as outras sugestões mantêm-se');

  // Segundo time-out: nesta parte já não pode pedir mais
  await banco.locator('#outros button', { hasText: /^Time-out$/ }).click();
  ok(await esperarPor(async () => (await q("SELECT 1 FROM eventos WHERE jogo_id = $1 AND tipo_evento_codigo = 'TIMEOUT'", [jogoId])).length === 2), 'assistente: o banco registou o 2.º time-out');
  await empurrar(dash, jogoId);
  ok(await esperarPor(async () => (await conteudo(painel.locator('.timeouts'))).includes('Águias do Norte 2/3 usados · sem time-outs agora')), 'assistente: com 2 time-outs na parte já não há mais para pedir');
  await banco.close();
  await dash.close();

  // Um jogo sem eventos: o painel existe mas não inventa sugestões
  const [{ id: vazioId }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [aguias.id, leoes.id, donoId]);
  const vazio = await pagina(`/dashboard.html?jogo=${vazioId}`);
  await vazio.locator('section.assistente').waitFor();
  ok((await vazio.locator('li.sugestao').count()) === 0 && (await conteudo(vazio.locator('section.assistente'))).includes('Sem sugestões por agora'), 'assistente: sem dados diz que não há sugestões');
  await vazio.close();
});

// ======================= Sem rede no pavilhão =======================
// Erros de consola que a falta de rede provoca (pedidos que falham, o SignalR a perder a ligação): são esperados aqui
const SEM_REDE = ['ERR_INTERNET_DISCONNECTED', 'Failed to fetch', 'Failed to load resource', 'WebSocket', 'negotiat', 'Server timeout elapsed', 'ERR_NETWORK_CHANGED'];

await passo('Sem rede: o banco guarda os eventos no tablet e envia-os sozinho quando a rede volta', async () => {
  const [{ id: jogoId }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [aguias.id, leoes.id, donoId]);
  // Um tablet sem service worker (ex.: a app aberta por http): a página já aberta tem de aguentar a falta de rede
  const ctxA = await novoContexto();
  await ctxA.addCookies(await ctx.cookies());
  const banco = await pagina(`/banco.html?jogo=${jogoId}`, { contexto: ctxA, tolerar: SEM_REDE });
  await banco.waitForSelector('.botao-jogador');
  ok(await esperarPor(async () => (await banco.locator('#ligacao').getAttribute('class'))?.includes('ok')), 'sem rede: banco ligado ao hub');
  ok(await banco.locator('#pendentes').isHidden(), 'sem rede: com rede não há eventos por enviar');

  const nEventos = async () => (await q('SELECT count(*)::int AS n FROM eventos WHERE jogo_id = $1', [jogoId]))[0].n;
  const naFila = () => banco.evaluate(() => JSON.parse(localStorage.getItem('scouting.fila.v1') ?? '[]').length);
  const caixa = await banco.locator('#campo').boundingBox();
  const tocar = async (rx, ry, nJogador) => {
    await banco.locator('#campo').click({ position: { x: caixa.width * rx, y: caixa.height * ry } });
    await banco.locator('.botao-jogador').nth(nJogador).click();
  };

  await ctxA.setOffline(true);
  ok(await esperarPor(async () => (await texto(banco.locator('#ligacao'))) === 'semrede'), 'sem rede: o banco avisa que está sem rede');
  const t0 = Date.now();

  // Um golo sem rede: aparece logo no placar e na lista, marcado «por enviar»
  await tocar(0.5, 0.5, 0);
  await golo(banco, 'BAIXO_ESQ');   // a baliza também se marca sem rede
  ok(await esperarPor(async () => (await texto(banco.locator('#pendentes'))) === '⏳1porenviar'), 'sem rede: o indicador diz «1 por enviar»');
  ok(((await banco.locator('#ultimos li.pendente').first().textContent()) ?? '').includes('baixo à esquerda'), 'sem rede: o golo por enviar já mostra onde entrou');
  ok((await texto(banco.locator('#golos-casa'))) === '1', 'sem rede: o golo conta logo no placar');
  ok((await banco.locator('#ultimos li.pendente').count()) === 1, 'sem rede: o golo aparece na lista marcado «por enviar»');
  await new Promise((r) => setTimeout(r, 400));
  await tocar(0.3, 0.6, 1);
  await banco.click('.botao-resultado[data-resultado="FORA"]');
  ok(await esperarPor(async () => (await texto(banco.locator('#pendentes'))) === '⏳2porenviar'), 'sem rede: o segundo evento junta-se à fila');
  await new Promise((r) => setTimeout(r, 400));
  await banco.locator('#outros button', { hasText: /^Time-out$/ }).click();
  ok(await esperarPor(async () => (await naFila()) === 3), 'sem rede: três eventos guardados no tablet (localStorage)');

  // Desfazer um evento por enviar tira-o da fila, sem precisar do servidor
  await banco.click('#btn-desfazer');
  ok(await esperarPor(async () => (await naFila()) === 2 && (await texto(banco.locator('#pendentes'))) === '⏳2porenviar'), 'sem rede: «desfazer» tira da fila o último evento por enviar');
  ok((await nEventos()) === 0, 'sem rede: nada chegou à base de dados');
  await captura(banco, 'banco-sem-rede');

  await new Promise((r) => setTimeout(r, 3000));   // a rede demora a voltar: o tempo do evento é o do toque, não o do envio
  const t1 = Date.now();
  const enviados = [];
  banco.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith(`/api/jogos/${jogoId}/eventos`)) enviados.push(JSON.parse(r.postData())); });
  await ctxA.setOffline(false);

  ok(await esperarPor(async () => (await nEventos()) === 2, 15000), `sem rede: com a rede de volta os eventos seguem sozinhos (${await nEventos()} na base de dados)`);
  ok(await esperarPor(async () => (await naFila()) === 0 && (await banco.locator('#pendentes').isHidden())), 'sem rede: a fila esvazia e o indicador desaparece');
  const linhasBd = await q('SELECT cliente_id, extract(epoch FROM criado_em) * 1000 AS ms, resultado, baliza_zona FROM eventos WHERE jogo_id = $1 ORDER BY id', [jogoId]);
  ok(linhasBd.length === 2 && linhasBd.every((l) => l.cliente_id) && new Set(linhasBd.map((l) => l.cliente_id)).size === 2, 'sem rede: cada evento tem o seu identificador (clienteId)');
  ok(linhasBd[0]?.resultado === 'GOLO' && linhasBd[1]?.resultado === 'FORA', 'sem rede: chegaram pela ordem em que foram registados');
  ok(linhasBd[0]?.baliza_zona === 'BAIXO_ESQ' && linhasBd[1]?.baliza_zona === null, `sem rede: o local do golo na baliza chega com o evento (${linhasBd[0]?.baliza_zona})`);
  ok(linhasBd.every((l) => Number(l.ms) >= t0 - 1000 && Number(l.ms) <= t1 + 1000), `sem rede: o tempo de cada evento é o do toque, não o do envio (${linhasBd.map((l) => Math.round((Date.now() - Number(l.ms)) / 1000)).join(', ')} s atrás)`);
  ok(new Set(enviados.map((e) => e.clienteId)).size === 2, `sem rede: cada evento foi enviado (${enviados.length} pedidos)`);

  // O mesmo evento enviado outra vez (a resposta perdeu-se) não é registado duas vezes
  const repetido = await ctxA.request.post(`${servidor.url}/api/jogos/${jogoId}/eventos`, { data: enviados[0] });
  const corpoRepetido = await repetido.json();
  ok(repetido.status() === 200 && corpoRepetido.repetido === true, `sem rede: reenviar o mesmo clienteId responde 200 «repetido» (${repetido.status()})`);
  ok(corpoRepetido.id != null && (await nEventos()) === 2, 'sem rede: o reenvio não cria um evento novo');

  // Com tudo no servidor o placar não conta duas vezes o que foi enviado
  await empurrar(banco, jogoId);
  ok(await esperarPor(async () => (await texto(banco.locator('#golos-casa'))) === '1' && (await banco.locator('#ultimos li').count()) === 2 && (await banco.locator('#ultimos li.pendente').count()) === 0),
    'sem rede: depois de enviados os eventos aparecem uma só vez, já sem a marca «por enviar»');
  await ctxA.close();
});

await passo('Sem rede: a app abre sem rede (service worker) e a lista de jogos envia o que ficou por enviar', async () => {
  const [{ id: jogoId }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [aguias.id, leoes.id, donoId]);
  const manifesto = await ctx.request.get(`${servidor.url}/manifest.webmanifest`);
  ok(manifesto.ok() && (manifesto.headers()['content-type'] ?? '').includes('manifest+json') && (await manifesto.json()).display === 'standalone', 'app instalável: o manifest é servido');
  ok((await ctx.request.get(`${servidor.url}/icons/icon-512.png`)).ok(), 'app instalável: os ícones são servidos');
  const sw = await ctx.request.get(`${servidor.url}/sw.js`);
  ok(sw.ok() && (sw.headers()['content-type'] ?? '').includes('javascript'), 'service worker: sw.js é servido como javascript');

  const ctxB = await novoContexto({ serviceWorkers: 'allow' });
  await ctxB.addCookies(await ctx.cookies());
  const banco = await pagina(`/banco.html?jogo=${jogoId}`, { contexto: ctxB, tolerar: SEM_REDE });
  await banco.waitForSelector('.botao-jogador');

  // O service worker instala-se e guarda a app (páginas, módulos, estilos, letras, ícones)
  const guardados = () => banco.evaluate(async () => {
    const nomes = await caches.keys();
    const cache = nomes.length ? await caches.open(nomes[0]) : null;
    return cache ? (await cache.keys()).map((r) => new URL(r.url).pathname) : [];
  });
  const obrigatorios = ['/banco.html', '/index.html', '/', '/css/estilo.css', '/js/banco.js', '/js/fila.js', '/js/offline.js', '/lib/signalr.min.js', '/fonts/barlow-latin-400-normal.woff2', '/icons/icon-192.png'];
  ok(await esperarPor(async () => { const g = await guardados(); return obrigatorios.every((o) => g.includes(o)); }, 20000),
    `service worker: guardou a app no tablet (${(await guardados()).length} ficheiros)`);
  ok(await esperarPor(() => banco.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active))), 'service worker: ativo');

  const nEventos = async () => (await q('SELECT count(*)::int AS n FROM eventos WHERE jogo_id = $1', [jogoId]))[0].n;
  const naFila = () => banco.evaluate(() => JSON.parse(localStorage.getItem('scouting.fila.v1') ?? '[]').length);
  const caixa = await banco.locator('#campo').boundingBox();

  // A rede cai a meio do jogo; o adjunto continua a registar e depois recarrega (ou fecha e reabre) a página
  await ctxB.setOffline(true);
  await banco.locator('#campo').click({ position: { x: caixa.width * 0.5, y: caixa.height * 0.5 } });
  await banco.locator('.botao-jogador').first().click();
  await golo(banco);
  ok(await esperarPor(async () => (await naFila()) === 1), 'service worker: o golo ficou na fila do tablet');

  await banco.reload({ waitUntil: 'domcontentloaded' });
  ok(await banco.locator('.botao-jogador').first().waitFor({ timeout: 15000 }).then(() => true, () => false), 'service worker: sem rede, recarregar a página abre o banco');
  ok(await esperarPor(async () => ((await texto(banco.locator('#aviso'))) ?? '').includes('Semrede:obancoabriucomosdadosguardados')), 'service worker: o banco avisa que abriu com os dados guardados no tablet');
  ok((await texto(banco.locator('#nome-casa'))) === 'ÁguiasdoNorte' && (await texto(banco.locator('#golos-casa'))) === '1', 'service worker: abre com as equipas e o golo por enviar já no placar');
  ok((await texto(banco.locator('#pendentes'))) === '⏳1porenviar' && (await naFila()) === 1, 'service worker: o golo continua por enviar depois de recarregar');
  ok(await banco.evaluate(() => navigator.serviceWorker.controller !== null), 'service worker: a página foi servida pelo service worker');
  ok((await nEventos()) === 0, 'service worker: nada chegou ainda à base de dados');

  // Sem rede, no banco, regista-se outro evento; a lista de jogos (também sem rede) mostra o que está por enviar
  await banco.locator('#outros button', { hasText: /^Time-out$/ }).click();
  ok(await esperarPor(async () => (await naFila()) === 2), 'service worker: sem rede continua a registar depois de recarregar');
  const lista = await pagina('/', { contexto: ctxB, tolerar: SEM_REDE });
  ok(await lista.locator('#fila-pendente').isVisible() && (await texto(lista.locator('#fila-pendente'))).startsWith('⏳2eventosdobancoporenviar'), 'service worker: a lista de jogos sem rede diz quantos eventos estão por enviar');
  ok(await esperarPor(async () => (await lista.locator(`a[href="banco.html?jogo=${jogoId}"]`).count()) === 1), 'service worker: a lista de jogos sem rede oferece os jogos já abertos no banco');
  await captura(lista, 'lista-sem-rede');

  // A rede volta: a lista e o banco (abertos ao mesmo tempo) enviam a mesma fila e o servidor não regista nada a dobrar
  await ctxB.setOffline(false);
  ok(await esperarPor(async () => (await nEventos()) === 2, 20000), `service worker: com a rede de volta chegam os 2 eventos (${await nEventos()})`);
  ok(await esperarPor(async () => (await naFila()) === 0 && await lista.locator('#fila-pendente').isHidden() && await banco.locator('#pendentes').isHidden()), 'service worker: a fila esvazia nas duas páginas');
  await new Promise((r) => setTimeout(r, 1500));
  const dupl = await q('SELECT count(*)::int AS n, count(DISTINCT cliente_id)::int AS d FROM eventos WHERE jogo_id = $1', [jogoId]);
  ok(dupl[0].n === 2 && dupl[0].d === 2, `service worker: duas páginas a enviar a mesma fila não duplicam eventos (${dupl[0].n} eventos, ${dupl[0].d} identificadores)`);
  await ctxB.close();
});

// ======================= Escudos das equipas =======================
await passo('Escudos: carregar, trocar e tirar o escudo da equipa', async () => {
  const [{ equipa_id: propriaId }] = await q('SELECT equipa_id FROM utilizadores WHERE id = $1', [donoId]);
  const [{ nome: nomePropria }] = await q('SELECT nome FROM equipas WHERE id = $1', [propriaId]);
  const [{ id: jogoId }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES ($1,$2,$3) RETURNING id', [propriaId, aguias.id, donoId]);
  const escudoDe = async () => (await q('SELECT tipo, dados, escudo_versao(equipa_id) AS versao FROM escudos WHERE equipa_id = $1', [propriaId]))[0];
  const srcDoEscudo = (page) => page.locator('#bloco-escudo img.escudo-grande').getAttribute('src');
  const carregou = (locator) => locator.evaluate((img) => img.complete && img.naturalWidth > 0);

  const p = await pagina('/equipas.html');
  await p.waitForSelector('#bloco-escudo');
  ok(await p.locator('#bloco-escudo .escudo-vazio').isVisible(), 'escudos: sem escudo a página mostra as iniciais da equipa');
  ok((await p.locator('#remover-escudo').isHidden()) && (await texto(p.locator('#escolher-escudo'))) === 'Escolherimagem', 'escudos: sem escudo só há «Escolher imagem»');
  ok((await p.locator('.item-equipa img.escudo').count()) === 0 && (await p.locator('#bloco-escudo input[type=file]').getAttribute('accept')).includes('image/png'), 'escudos: a lista ainda não tem escudos e o seletor aceita imagens');

  // Uma imagem grande (600 x 300) é reduzida pelo browser a 256 x 128 antes de seguir para a API
  await p.setInputFiles('#ficheiro-escudo', { name: 'clube.png', mimeType: 'image/png', buffer: criarPng(600, 300, [200, 30, 40]) });
  await p.waitForSelector('#bloco-escudo img.escudo-grande');
  const primeiro = await escudoDe();
  ok(primeiro?.tipo === 'image/png' && largura(primeiro.dados) === 256 && altura(primeiro.dados) === 128 && primeiro.dados.length < 200 * 1024,
    `escudos: o escudo 600×300 ficou guardado reduzido a 256×128 (${primeiro && largura(primeiro.dados)}×${primeiro && altura(primeiro.dados)}, ${primeiro?.dados.length} bytes)`);
  ok(await carregou(p.locator('#bloco-escudo img.escudo-grande')), 'escudos: a página mostra o escudo (a imagem carregou)');
  ok(((await srcDoEscudo(p)) ?? '').endsWith(`/api/equipas/${propriaId}/escudo?v=${primeiro.versao}`), 'escudos: o endereço da imagem leva a versão');
  ok((await p.locator('#bloco-escudo .escudo-vazio').count()) === 0 && (await p.locator('#remover-escudo').isVisible()) && (await texto(p.locator('#escolher-escudo'))) === 'Trocarimagem', 'escudos: com escudo aparecem «Trocar imagem» e «Tirar escudo»');
  ok((await p.locator('.item-equipa img.escudo').count()) === 1, 'escudos: a equipa na lista também mostra o escudo');
  await captura(p, 'equipas-escudo');

  // Quem não tem conta vê a imagem e a API trata a cache (ETag)
  const imagemAberta = await ctxVisitante.request.get(`${servidor.url}/api/equipas/${propriaId}/escudo?v=${primeiro.versao}`);
  ok(imagemAberta.status() === 200 && imagemAberta.headers()['content-type'] === 'image/png' && imagemAberta.headers()['x-content-type-options'] === 'nosniff',
    'escudos: o escudo vê-se sem conta (imagem PNG, sem adivinhar o tipo)');
  ok(imagemAberta.headers()['cache-control']?.includes('max-age=86400'), 'escudos: com a versão no endereço a imagem fica um dia na cache');
  const semMudar = await ctxVisitante.request.get(`${servidor.url}/api/equipas/${propriaId}/escudo`, { headers: { 'If-None-Match': imagemAberta.headers().etag } });
  ok(semMudar.status() === 304, 'escudos: se não mudou a API responde 304');

  // Aparece onde o jogo aparece: placar do banco e do dashboard, lista de jogos, convocatória e área de convidado
  const banco = await pagina(`/banco.html?jogo=${jogoId}`);
  await banco.waitForSelector('#escudo-casa img');
  ok(await carregou(banco.locator('#escudo-casa img')) && (await banco.locator('#escudo-fora img').count()) === 0, 'escudos: o placar do banco mostra o escudo da casa e não inventa o do adversário');
  await captura(banco, 'banco-escudo');
  const dash = await pagina(`/dashboard.html?jogo=${jogoId}`);
  await dash.waitForSelector('#escudo-casa img');
  ok(await carregou(dash.locator('#escudo-casa img')) && (await dash.locator('#escudo-fora img').count()) === 0, 'escudos: o placar do dashboard também');
  const jogos = await pagina('/');
  await jogos.waitForSelector('.jogo-linha');
  ok((await jogos.locator('.jogo-linha', { hasText: nomePropria }).first().locator('img.escudo').count()) >= 1, 'escudos: a lista de jogos mostra o escudo');
  const conv = await pagina(`/convocatoria.html?jogo=${jogoId}`);
  await conv.waitForSelector('.cabecalho-equipa');
  ok((await conv.locator('.cabecalho-equipa img.escudo').count()) === 1, 'escudos: a convocatória mostra o escudo (só o da equipa que o tem)');
  const convidado = await pagina('/convidado.html', { contexto: ctxVisitante, tolerar: ['401'] });
  const linhaConvidado = convidado.locator('#lista-direto .jogo-direto', { hasText: nomePropria });
  await linhaConvidado.first().waitFor();
  ok(await carregou(linhaConvidado.first().locator('img.escudo')), 'escudos: a lista de jogos da área de convidado mostra o escudo');
  const aoVivo = await (await ctxVisitante.request.get(`${servidor.url}/api/convidado/jogos-em-direto`)).json();
  ok(aoVivo.some((j) => j.id === jogoId && j.casaId === propriaId && j.casaEscudo === Number(primeiro.versao) && j.foraEscudo == null), 'escudos: a lista pública traz a versão do escudo de cada equipa');
  await captura(convidado, 'convidado-escudo');
  await Promise.all([banco.close(), dash.close(), jogos.close(), conv.close(), convidado.close()]);

  // Trocar o escudo (aqui por um SVG pequeno, ampliado até aos 256 px) muda a versão e, com ela, o endereço
  const srcAntes = await srcDoEscudo(p);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#2457e6"/></svg>';
  await p.setInputFiles('#ficheiro-escudo', { name: 'clube.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  ok(await esperarPor(async () => (await srcDoEscudo(p)) !== srcAntes), 'escudos: ao trocar a imagem o endereço muda (o browser vai buscar a nova)');
  const segundo = await escudoDe();
  ok(segundo.tipo === 'image/png' && largura(segundo.dados) === 256 && altura(segundo.dados) === 128 && Number(segundo.versao) > Number(primeiro.versao),
    `escudos: o SVG ficou guardado como PNG 256×128 (${largura(segundo.dados)}×${altura(segundo.dados)})`);
  ok((await q('SELECT 1 FROM escudos WHERE equipa_id = $1', [propriaId])).length === 1, 'escudos: cada equipa tem um só escudo');

  // Ficheiros que não servem: a mensagem explica e o escudo fica como estava
  await p.setInputFiles('#ficheiro-escudo', { name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('não sou uma imagem') });
  ok(await esperarPor(async () => ((await p.locator('#bloco-escudo .erro-formulario').textContent()) ?? '').includes('Escolhe uma imagem')), 'escudos: um ficheiro que não é imagem é recusado com uma mensagem');
  await p.setInputFiles('#ficheiro-escudo', { name: 'falso.png', mimeType: 'image/png', buffer: Buffer.from('isto parece um png mas não é') });
  ok(await esperarPor(async () => ((await p.locator('#bloco-escudo .erro-formulario').textContent()) ?? '').includes('Não foi possível ler')), 'escudos: uma imagem estragada é recusada com uma mensagem');
  ok(Number((await escudoDe()).versao) === Number(segundo.versao), 'escudos: depois dos erros o escudo continua o mesmo');
  ok(await p.locator('#escolher-escudo').isEnabled(), 'escudos: depois de um erro dá para escolher outra imagem');

  // Tirar o escudo (a confirmação é aceite pelo teste)
  await p.click('#remover-escudo');
  ok(await esperarPor(async () => (await escudoDe()) === undefined), 'escudos: «Tirar escudo» apaga-o da base de dados');
  ok(await esperarPor(async () => await p.locator('#bloco-escudo .escudo-vazio').isVisible() && (await p.locator('.item-equipa img.escudo').count()) === 0 && await p.locator('#remover-escudo').isHidden()), 'escudos: sem escudo voltam as iniciais');
  ok((await ctxVisitante.request.get(`${servidor.url}/api/equipas/${propriaId}/escudo`)).status() === 404, 'escudos: sem escudo a imagem dá 404');
  await p.close();
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
  await linha.getByRole('button', { name: 'Copiar ligação' }).click();
  await lista.waitForFunction(() => document.getElementById('aviso').textContent.includes('Ligação copiada'));
  const copiado = await lista.evaluate(() => navigator.clipboard.readText());
  ok(copiado === `${servidor.url}/dashboard.html?jogo=${novoJogoId}&c=${codigoNovo}`, `jogos: "Copiar ligação" copia o endereço de partilha (${copiado})`);
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
  ok((await v.evaluate(() => navigator.clipboard.readText())) === `${servidor.url}/dashboard.html?jogo=2&c=${codigo}`, 'visitante: "Copiar ligação" copia o mesmo endereço');
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
  ok((await e.locator('#erro-link').textContent()).includes('Cola a ligação'), 'convidado: sem link pede para colar o link');
  for (const mau of ['isto não é um link', `${servidor.url}/dashboard.html?jogo=2&c=curto`, `${servidor.url}/dashboard.html?c=${codigo}`, `${servidor.url}/dashboard.html?jogo=0&c=${codigo}`]) {
    await e.fill('#link-jogo', mau);
    await e.click('#form-link button[type=submit]');
    ok((await e.locator('#erro-link').textContent()).includes('não parece a ligação de um jogo') && e.url().includes('convidado.html'), `convidado: recusa "${mau.replace(servidor.url, '')}" e fica na página`);
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
await passo('Estatísticas: os números de cada jogador da equipa da conta, somados em todos os jogos, e jogo a jogo', async () => {
  const [{ equipa_id: propriaId }] = await q('SELECT equipa_id FROM utilizadores WHERE id = $1', [donoId]);
  const [{ nome: nomePropria }] = await q('SELECT nome FROM equipas WHERE id = $1', [propriaId]);
  const novoJogador = async (numero, nome, posicao) => (await q('INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo) VALUES ($1,$2,$3,$4) RETURNING id', [propriaId, numero, nome, posicao]))[0].id;
  const gr = await novoJogador(91, 'Nuno Guarda', 'GR');
  const bruno = await novoJogador(92, 'Bruno Remata', 'LE');
  const carlos = await novoJogador(93, 'Carlos Pivô', 'PV');
  await novoJogador(94, 'Duarte Banco', 'CE');   // nunca joga
  const [{ id: adversario }] = await q("SELECT id FROM jogadores WHERE equipa_id = $1 AND posicao_codigo <> 'GR' ORDER BY numero LIMIT 1", [aguias.id]);

  let segundo = 0;
  const evento = (jogoId, equipa, tipo, jogador, { resultado = null, situacao = 'POSICIONAL', guardaRedes = null } = {}) => q(
    `INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, guarda_redes_id, resultado, situacao, x, y, parte, segundo_jogo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10)`,
    [jogoId, equipa, tipo, jogador, guardaRedes, resultado, situacao, resultado ? 50 : null, resultado ? 40 : null, (segundo += 15)]);
  const remates = async (jogoId, equipa, jogador, lista, opcoes = {}) => { for (const resultado of lista) await evento(jogoId, equipa, 'REMATE', jogador, { resultado, ...opcoes }); };
  const novoJogo = async (casa, fora, dataHora) => (await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id, data_hora) VALUES ($1,$2,$3,$4) RETURNING id', [casa, fora, donoId, dataHora]))[0].id;

  // Jogo A (em casa, 4–3): o Bruno marca 4 em 7 (1 em 2 de 7 metros) e perde 2 bolas e leva 2 minutos; o Carlos é convocado e não remata;
  // o guarda-redes defende 4 e sofre 3 (1 defesa em 2 lançamentos de 7 metros)
  const jogoA = await novoJogo(propriaId, aguias.id, '2026-09-05T18:00:00Z');
  await q('INSERT INTO convocados (jogo_id, jogador_id) VALUES ($1,$2), ($1,$3)', [jogoA, carlos, gr]);
  await remates(jogoA, propriaId, bruno, ['GOLO', 'GOLO', 'GOLO', 'FORA', 'DEFESA']);
  await remates(jogoA, propriaId, bruno, ['GOLO', 'DEFESA'], { situacao: 'SETE_METROS' });
  await evento(jogoA, propriaId, 'PERDA_BOLA', bruno); await evento(jogoA, propriaId, 'PERDA_BOLA', bruno);
  await evento(jogoA, propriaId, 'DOIS_MINUTOS', bruno);
  await remates(jogoA, aguias.id, adversario, ['DEFESA', 'DEFESA', 'DEFESA', 'GOLO', 'GOLO'], { guardaRedes: gr });
  await remates(jogoA, aguias.id, adversario, ['DEFESA', 'GOLO'], { situacao: 'SETE_METROS', guardaRedes: gr });
  // Jogo B (fora, 4–5): o Bruno marca 2 em 5 (1 em 2 em contra-ataque); o Carlos marca 2 em 2 e faz uma falta ofensiva; o guarda-redes defende 2 e sofre 5
  const jogoB = await novoJogo(aguias.id, propriaId, '2026-09-12T18:00:00Z');
  await remates(jogoB, propriaId, bruno, ['GOLO', 'FORA', 'FORA']);
  await remates(jogoB, propriaId, bruno, ['GOLO', 'DEFESA'], { situacao: 'CONTRA_ATAQUE' });
  await remates(jogoB, propriaId, carlos, ['GOLO', 'GOLO']);
  await evento(jogoB, propriaId, 'FALTA_OFENSIVA', carlos);
  await remates(jogoB, aguias.id, adversario, ['DEFESA', 'DEFESA', 'GOLO', 'GOLO', 'GOLO', 'GOLO', 'GOLO'], { guardaRedes: gr });
  // Um jogo da equipa ainda sem nada registado e um jogo de outras equipas: não entram nas contas
  await novoJogo(propriaId, aguias.id, '2026-09-19T18:00:00Z');

  // O menu leva à página, em todas as páginas da conta
  for (const url of ['/', '/equipas.html']) {
    const m = await pagina(url);
    ok((await m.locator('.menu a[href="estatisticas.html"]').textContent()) === 'Estatísticas', `estatísticas: o menu de ${url} tem a aba «Estatísticas»`);
    if (url === '/') {
      await Promise.all([m.waitForURL(/estatisticas\.html/), m.click('.menu a[href="estatisticas.html"]')]);
      await m.waitForSelector('#tabela-estatisticas');
      ok((await m.locator('.menu a[aria-current="page"]').textContent()) === 'Estatísticas', 'estatísticas: no menu, a aba da página fica assinalada');
    }
    await m.close();
  }
  const p = await pagina('/estatisticas.html');
  await p.waitForSelector('#tabela-estatisticas');
  ok((await p.title()) === `Estatísticas · ${nomePropria}`, `estatísticas: o título do separador leva a equipa (${await p.title()})`);
  ok(((await p.locator('.sub-equipa').textContent()) ?? '').includes(nomePropria), 'estatísticas: diz de que equipa são os números (a da conta)');
  const resumo = async () => [await texto(p.locator('#resumo-jogos b')), await texto(p.locator('#resumo-resultados b')), await texto(p.locator('#resumo-golos b')), await texto(p.locator('#resumo-sofridos b'))];
  ok(JSON.stringify(await resumo()) === JSON.stringify(['2', '1-0-1', '8', '8']), `estatísticas: o resumo conta só os jogos com registos: 2 jogos, 1 vitória e 1 derrota, 8 golos marcados e 8 sofridos (${await resumo()})`);
  ok((await p.locator('[aria-label="O que ver"] button').allTextContents()).join('|') === 'Ataque|Guarda-redes|Bola e disciplina' && (await p.locator('[aria-label="O que ver"] button.ativo').textContent()) === 'Ataque', 'estatísticas: três vistas, a começar pelo ataque');

  const linhas = async () => p.locator('#tabela-estatisticas tbody tr.linha-jogador').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent.trim())));
  const rodape = async () => p.locator('#tabela-estatisticas tfoot td').allTextContents();
  const numeros = (linha) => [linha[0], ...linha.slice(2)].join('|');
  let l = await linhas();
  ok(l.length === 2 && l[0][1].includes('Bruno Remata') && l[1][1].includes('Carlos Pivô'), `estatísticas: o ataque tem os dois jogadores que jogaram, o melhor marcador primeiro (${l.map((x) => x[0])})`);
  ok(numeros(l[0]) === '92|2|6|12|50%|3,0|1/2|1/2', `estatísticas: o Bruno soma os dois jogos: 6 golos em 12 remates, 7 m 1/2, contra-ataque 1/2 (${numeros(l[0])})`);
  ok(numeros(l[1]) === '93|2|2|2|100%|1,0|–|–', `estatísticas: o Carlos jogou os dois jogos (um só convocado), 2 em 2 (${numeros(l[1])})`);
  ok((await rodape()).slice(1).join('|') === 'Equipa|2|8|14|57%|4,0|1/2|1/2', `estatísticas: a linha da equipa soma os jogadores e conta os jogos da equipa (${(await rodape()).slice(1)})`);
  ok(((await p.locator('#sem-jogos').textContent()) ?? '').includes('#94 Duarte Banco'), 'estatísticas: quem ainda não jogou aparece à parte');
  ok((await p.locator('#tabela-estatisticas tbody').textContent()).includes('Duarte') === false, 'estatísticas: quem não jogou não tem linha na tabela');
  await captura(p, 'estatisticas');

  // Ordenar: pela eficácia (o Carlos tem 100%), outra vez (inverte) e pelo número
  const ordem = async () => (await linhas()).map((x) => x[0]).join(',');
  await p.locator('th button.ordenar', { hasText: 'Eficácia' }).click();
  ok((await ordem()) === '93,92' && (await p.locator('th[aria-sort="descending"]').textContent()) === 'Eficácia', `estatísticas: ordenar pela eficácia põe o melhor primeiro (${await ordem()})`);
  await p.locator('th button.ordenar', { hasText: 'Eficácia' }).click();
  ok((await ordem()) === '92,93' && (await p.locator('th[aria-sort="ascending"]').count()) === 1, `estatísticas: clicar outra vez inverte (${await ordem()})`);
  await p.locator('th button.ordenar', { hasText: '#' }).click();
  ok((await ordem()) === '92,93' && (await p.locator('th[aria-sort="ascending"]').textContent()) === '#', 'estatísticas: o número da camisola ordena do mais baixo para o mais alto');

  // Jogo a jogo: clicar no jogador abre os jogos dele
  const bot = p.locator('tr.linha-jogador', { hasText: 'Bruno Remata' }).locator('button.abrir-jogador');
  ok((await bot.getAttribute('aria-expanded')) === 'false' && (await p.locator('tr.detalhe-jogador').count()) === 0, 'estatísticas: o jogo a jogo começa fechado');
  await bot.click();
  const jogos = await p.locator('tr.detalhe-jogador table.tabela-jogos tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent.trim())));
  ok(jogos.length === 2 && jogos[0].join('|') === `05/09/2026 · vs Águias do Norte|V 4–3|1|4|7|57%|4,0|1/2|–`, `estatísticas: o 1.º jogo (do mais antigo ao mais recente) (${jogos[0]})`);
  ok(jogos[1]?.join('|') === `12/09/2026 · em Águias do Norte|D 4–5|1|2|5|40%|2,0|–|1/2`, `estatísticas: o 2.º jogo, fora e perdido (${jogos[1]})`);
  ok((await p.locator('tr.linha-jogador', { hasText: 'Bruno Remata' }).locator('button.abrir-jogador').getAttribute('aria-expanded')) === 'true', 'estatísticas: o jogador aberto fica assinalado');
  await captura(p, 'estatisticas-jogo-a-jogo');
  await p.locator('tr.linha-jogador', { hasText: 'Bruno Remata' }).locator('button.abrir-jogador').click();
  ok((await p.locator('tr.detalhe-jogador').count()) === 0, 'estatísticas: clicar outra vez fecha o jogo a jogo');

  // Guarda-redes
  await p.locator('[aria-label="O que ver"] button', { hasText: 'Guarda-redes' }).click();
  l = await linhas();
  ok(l.length === 1 && numeros(l[0]) === '91|2|6|8|14|43%|3,0|1/2', `estatísticas: o guarda-redes defendeu 6 e sofreu 8 (43% de defesa), 1 de 2 sete metros (${l.map(numeros)})`);
  ok((await rodape()).slice(1).join('|') === 'Equipa|2|6|8|14|43%|3,0|1/2', `estatísticas: a linha da equipa nos guarda-redes (${(await rodape()).slice(1)})`);

  // Bola e disciplina: todos os que jogaram, por ordem de exclusões
  await p.locator('[aria-label="O que ver"] button', { hasText: 'Bola e disciplina' }).click();
  l = await linhas();
  ok(l.map((x) => x[0]).join(',') === '92,91,93' && numeros(l[0]) === '92|2|2|0|1|0' && numeros(l[2]) === '93|2|0|1|0|0', `estatísticas: perdas de bola, faltas, 2 minutos e vermelhos (${l.map(numeros)})`);
  await p.close();

  // A API: a equipa da conta responde; quem não tem sessão não lê
  const resposta = await ctx.request.get(`${servidor.url}/api/equipas/${propriaId}/estatisticas`);
  const dados = await resposta.json();
  ok(resposta.status() === 200 && dados.equipaId === propriaId && dados.jogos.length === 2 && dados.plantel.length >= 4 && dados.linhas.some((x) => x.jogadorId === bruno && x.remates === 7),
    'estatísticas (API): a equipa da conta devolve o plantel, os jogos com registos e uma linha por jogador e jogo');
  ok((await ctxVisitante.request.get(`${servidor.url}/api/equipas/${propriaId}/estatisticas`)).status() === 401, 'estatísticas (API): sem sessão não se lê');
  ok((await ctx.request.get(`${servidor.url}/api/equipas/999999/estatisticas`)).status() === 404, 'estatísticas (API): uma equipa que não existe dá 404');
});

await passo('Estatísticas: filtros (em casa, fora, parte, últimos jogos) e gráficos de evolução jogo a jogo', async () => {
  const [{ equipa_id: propriaId }] = await q('SELECT equipa_id FROM utilizadores WHERE id = $1', [donoId]);
  const [{ id: bruno }] = await q('SELECT id FROM jogadores WHERE equipa_id = $1 AND numero = 92', [propriaId]);
  const [{ id: guardaRedes }] = await q('SELECT id FROM jogadores WHERE equipa_id = $1 AND numero = 91', [propriaId]);
  const [{ id: jogoA }] = await q("SELECT id FROM jogos WHERE dono_id = $1 AND equipa_casa_id = $2 AND data_hora = '2026-09-05T18:00:00Z'", [donoId, propriaId]);
  const [{ id: deAguias }] = await q("SELECT id FROM jogadores WHERE equipa_id = $1 AND posicao_codigo <> 'GR' ORDER BY numero LIMIT 1", [aguias.id]);
  const [{ id: deLeoes }] = await q("SELECT id FROM jogadores WHERE equipa_id = $1 AND posicao_codigo <> 'GR' ORDER BY numero LIMIT 1", [leoes.id]);

  const novoJogo = async (casa, fora, dataHora) => (await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id, data_hora) VALUES ($1,$2,$3,$4) RETURNING id', [casa, fora, donoId, dataHora]))[0].id;
  const remates = async (jogoId, equipa, jogador, n, { resultado = 'GOLO', parte = 1 } = {}) => {
    for (let i = 0; i < n; i++) {
      await q(`INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, resultado, situacao, x, y, parte, segundo_jogo)
               VALUES ($1,$2,'REMATE',$3,$4,'POSICIONAL',50,40,$5,$6)`, [jogoId, equipa, jogador, resultado, parte, parte === 1 ? 600 + i : 2400 + i]);
    }
  };
  // Até aqui: A (05/09, em casa, 4–3), B (12/09, fora, 4–5) e um jogo sem registos. Na 2.ª parte do A: 1–1 (o A passa a 5–4).
  await remates(jogoA, propriaId, bruno, 1, { parte: 2 });
  await remates(jogoA, aguias.id, deAguias, 1, { parte: 2 });
  // Mais quatro jogos contra os Leões: C1 em casa 2–0, C2 fora 1–1, C3 em casa 3–0, C4 fora 0–2 (um remate falhado do Bruno)
  const c1 = await novoJogo(propriaId, leoes.id, '2026-09-20T18:00:00Z');
  await remates(c1, propriaId, bruno, 2);
  const c2 = await novoJogo(leoes.id, propriaId, '2026-09-21T18:00:00Z');
  await remates(c2, propriaId, bruno, 1); await remates(c2, leoes.id, deLeoes, 1);
  const c3 = await novoJogo(propriaId, leoes.id, '2026-09-22T18:00:00Z');
  await remates(c3, propriaId, bruno, 3);
  const c4 = await novoJogo(leoes.id, propriaId, '2026-09-23T18:00:00Z');
  await remates(c4, propriaId, bruno, 1, { resultado: 'FORA' }); await remates(c4, leoes.id, deLeoes, 2);
  // Tudo: 6 jogos, 3 vitórias, 1 empate e 2 derrotas, 15 golos marcados e 12 sofridos

  const pedidos = [];
  const p = await pagina('/estatisticas.html');
  p.on('request', (r) => { if (/\/estatisticas(\?|$)/.test(r.url())) pedidos.push(new URL(r.url()).search); });
  await p.reload();
  await p.waitForSelector('#tabela-estatisticas');
  const resumo = async () => [await texto(p.locator('#resumo-jogos b')), await texto(p.locator('#resumo-resultados b')), await texto(p.locator('#resumo-golos b')), await texto(p.locator('#resumo-sofridos b'))].join(' | ');
  const nota = async () => ((await p.locator('#nota-filtros').count()) ? ((await p.locator('#nota-filtros').textContent()) ?? '').trim() : null);
  // O gráfico desenha-se logo a seguir a entrar na página (quando tem largura): espera-se pelos pontos que se esperam
  const pontos = async (esperados = null) => {
    if (esperados !== null) {
      await p.waitForFunction((n) => document.querySelectorAll('#grafico-equipa .grafico-ponto').length === n, esperados, { timeout: 5000 }).catch(() => {});
    }
    return p.locator('#grafico-equipa .grafico-ponto').count();
  };
  const escolher = async (filtro) => { await p.click(`[data-filtro="${filtro}"]`); await p.waitForSelector(`[data-filtro="${filtro}"].ativo`); };
  const ativos = async () => (await p.locator('.filtros-estatisticas button.ativo').allTextContents()).join('|');

  // Os três grupos de filtros começam no jogo todo, em todos os jogos e em toda a época
  ok((await p.locator('.filtros-estatisticas .grupo-filtro').count()) === 3 && (await ativos()) === 'Todos|Jogo todo|Toda a época', `filtros: três grupos (jogos, parte, período), tudo escolhido à partida (${await ativos()})`);
  ok((await p.locator('.filtros-estatisticas button.ativo[aria-pressed="true"]').count()) === 3 && (await nota()) === null, 'filtros: o botão escolhido está assinalado (aria-pressed) e não há nota de filtros');
  ok((await resumo()) === '6 | 3-1-2 | 15 | 12', `filtros: sem filtros contam os 6 jogos com registos: 3-1-2, 15 marcados e 12 sofridos (${await resumo()})`);

  // O gráfico: golos marcados e sofridos, uma bola por jogo e série
  const grafico = p.locator('#grafico-equipa');
  ok((await grafico.locator('figcaption').textContent()) === 'Golos marcados e sofridos em cada jogo' && (await grafico.locator('.grafico-legenda li').allTextContents()).join('|') === 'Marcados|Sofridos',
    'gráfico: o título diz o que mostra e a legenda tem as duas séries (marcados, sofridos)');
  ok((await pontos(12)) === 12 && (await grafico.locator('.grafico-linha').count()) === 2, `gráfico: 6 jogos × 2 séries = 12 pontos e 2 linhas (${await pontos()})`);
  ok((await grafico.locator('.grafico-ponto').first().getAttribute('r')) === '4.5', 'gráfico: os pontos têm raio 4,5');
  ok((await grafico.locator('.grafico-eixo-x text').first().textContent()) === '05/09', 'gráfico: o eixo horizontal começa na data do primeiro jogo');
  await captura(p, 'estatisticas-graficos');

  // Passar o rato por cima do último jogo: cruz e dica com os valores dele
  const alvo = await grafico.locator('.grafico-alvo').boundingBox();
  await p.mouse.move(alvo.x + alvo.width - 2, alvo.y + 30);
  await grafico.locator('.grafico-dica').waitFor({ state: 'visible' });
  const dica = await texto(grafico.locator('.grafico-dica'));
  ok(dica.includes('23/09/2026') && dica.includes('emLeõesdoSul') && dica.includes('D0–2'), `gráfico: a dica diz o jogo, o adversário e o resultado (${dica})`);
  ok((await grafico.locator('.grafico-dica strong').allTextContents()).join('|') === '0|2', 'gráfico: e os valores das duas séries (0 marcados, 2 sofridos)');
  ok((await grafico.locator('.grafico-cruz').evaluate((el) => el.style.display)) === '', 'gráfico: aparece a linha vertical sobre o jogo em foco');
  await captura(p, 'estatisticas-grafico-dica');
  await p.mouse.move(2, 2);
  await grafico.locator('.grafico-dica').waitFor({ state: 'hidden' });
  ok(await grafico.locator('.grafico-dica').isHidden() && (await grafico.locator('.grafico-cruz').evaluate((el) => el.style.display)) === 'none', 'gráfico: ao tirar o rato a dica e a linha vertical desaparecem');

  // Com o teclado: focar o gráfico mostra o último jogo, as setas percorrem os jogos
  await grafico.locator('svg').focus();
  ok((await texto(grafico.locator('.grafico-dica'))).includes('23/09/2026'), 'gráfico: ao focar com o teclado mostra o último jogo');
  await p.keyboard.press('ArrowLeft');
  ok((await texto(grafico.locator('.grafico-dica'))).includes('22/09/2026'), 'gráfico: a seta para a esquerda vai ao jogo anterior');
  await p.keyboard.press('Home');
  ok((await texto(grafico.locator('.grafico-dica'))).includes('05/09/2026'), 'gráfico: Home vai ao primeiro jogo');
  await p.keyboard.press('Escape');
  ok(await grafico.locator('.grafico-dica').isHidden(), 'gráfico: Esc fecha a dica');

  // A tabela com os mesmos números
  await grafico.locator('.grafico-alternar').click();
  const linhasTabela = await grafico.locator('.grafico-tabela tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent.trim()).join('|')));
  ok(linhasTabela.length === 6 && linhasTabela[0] === '05/09/2026 · vs Águias do Norte · V 5–4|5|4' && linhasTabela[5] === '23/09/2026 · em Leões do Sul · D 0–2|0|2', `gráfico: «Ver como tabela» mostra os 6 jogos com os mesmos números (${linhasTabela[0]})`);
  ok(await grafico.locator('.grafico-area').isHidden() && (await grafico.locator('.grafico-alternar').textContent()) === 'Ver gráfico' && (await grafico.locator('.grafico-alternar').getAttribute('aria-pressed')) === 'true', 'gráfico: na vista de tabela o gráfico esconde-se e o botão passa a «Ver gráfico»');
  await grafico.locator('.grafico-alternar').click();
  ok(await grafico.locator('.grafico-tabela').isHidden() && (await pontos(12)) === 12, 'gráfico: «Ver gráfico» volta ao gráfico, desenhado outra vez');

  // Os outros gráficos
  const aba = (codigo) => p.locator(`[data-grafico="${codigo}"]`);
  await aba('eficacia').click();
  ok((await p.locator('#grafico-equipa figcaption').textContent()).startsWith('Eficácia de remate') && (await pontos(6)) === 6 && (await p.locator('#grafico-equipa .grafico-legenda').count()) === 0
    && (await aba('eficacia').getAttribute('aria-pressed')) === 'true', `gráfico: a eficácia tem uma só série (sem legenda) e 6 pontos (${await pontos()})`);
  ok((await p.locator('#grafico-equipa .grafico-grelha text').last().textContent()) === '100%', 'gráfico: nas percentagens o eixo vai até 100%');
  await aba('defesa').click();
  ok((await pontos(2)) === 2, `gráfico: a defesa dos guarda-redes só tem os 2 jogos em que se registou o guarda-redes (${await pontos()})`);
  await aba('perdas').click();
  ok((await pontos(6)) === 6 && (await p.locator('#grafico-equipa .grafico-valor').count()) >= 1, 'gráfico: as perdas de bola têm 6 pontos e o valor do último jogo');
  await aba('golos').click();

  // Em casa / fora
  await escolher('local-casa');
  ok((await resumo()) === '3 | 3-0-0 | 10 | 4' && (await nota()) === 'A ver: jogos em casa.' && (await pontos(6)) === 6, `filtros: «Em casa» (A, C1 e C3): 3 vitórias, 10 golos marcados e 4 sofridos (${await resumo()}) e a nota diz o que se vê`);
  ok((await p.locator('#grafico-equipa .grafico-eixo-x text:not(.segunda-linha)').allTextContents()).join(',') === '05/09,20/09,22/09', 'filtros: o gráfico só tem os jogos em casa');
  await escolher('local-fora');
  ok((await resumo()) === '3 | 0-1-2 | 5 | 8' && (await nota()) === 'A ver: jogos fora.', `filtros: «Fora» (B, C2 e C4): 0-1-2, 5 marcados e 8 sofridos (${await resumo()})`);
  await captura(p, 'estatisticas-filtros');
  await escolher('local-todos');
  await escolher('ultimos-5');
  ok((await resumo()) === '5 | 2-1-2 | 10 | 8' && (await nota()) === 'A ver: os últimos 5 jogos.' && (await pontos(10)) === 10, `filtros: «Últimos 5 jogos» (sem o primeiro): 2-1-2, 10 marcados e 8 sofridos (${await resumo()})`);
  await escolher('local-casa');
  ok((await resumo()) === '3 | 3-0-0 | 10 | 4' && (await nota()) === 'A ver: jogos em casa, os últimos 5 jogos.', `filtros: os filtros somam-se, e os últimos 5 contam-se entre os jogos em casa (${await resumo()})`);
  await escolher('ultimos-todos');
  // A tabela segue os filtros: em casa (A, C1 e C3) o Bruno soma 3 jogos, 10 golos em 13 remates
  const linhaDe = async (numero) => (await p.locator('#tabela-estatisticas tbody tr.linha-jogador').evaluateAll((trs, n) => trs.map((tr) => [...tr.cells].map((c) => c.textContent.trim())).find((l) => l[0] === n), String(numero))) ?? [];
  const numeros = (linha) => [linha[0], ...linha.slice(2)].join('|');
  ok(numeros(await linhaDe(92)) === '92|3|10|13|77%|3,3|1/2|–', `filtros: a tabela recalcula com os jogos escolhidos: em casa o Bruno soma 3 jogos e 10 golos em 13 remates (${numeros(await linhaDe(92))})`);
  await escolher('local-fora');
  ok(numeros(await linhaDe(92)) === '92|3|3|7|43%|1,0|–|1/2', `filtros: fora (B, C2 e C4) o Bruno soma 3 golos em 7 remates (${numeros(await linhaDe(92))})`);
  await escolher('local-todos');

  // Por parte: os números pedem-se ao servidor (e guardam-se: voltar a uma parte já vista não pede outra vez)
  ok(pedidos.length === 1 && pedidos[0] === '', `parte: até aqui só se pediu o jogo todo, uma vez (${pedidos})`);
  await Promise.all([p.waitForResponse((r) => r.url().includes('?parte=2')), escolher('parte-2')]);
  ok((await resumo()) === '1 | 0-1-0 | 1 | 1', `parte: «2.ª parte» só tem o jogo A (1–1): 1 jogo, um empate, 1 golo marcado e 1 sofrido (${await resumo()})`);
  ok((await nota()).includes('só a 2.ª parte') && (await nota()).includes('são os dessa parte') && (await pontos(2)) === 2, 'parte: a nota explica que os golos e os resultados são os dessa parte');
  ok(numeros(await linhaDe(92)) === '92|1|1|1|100%|1,0|–|–', `parte: na 2.ª parte o Bruno tem 1 jogo e 1 golo em 1 remate (${numeros(await linhaDe(92))})`);
  ok(((await p.locator('#sem-jogos').textContent()) ?? '').startsWith('Sem jogos nesta seleção:') && (await p.locator('#sem-jogos').textContent()).includes('#94 Duarte Banco'), 'parte: com filtros a nota dos que não jogaram passa a «Sem jogos nesta seleção»');
  await captura(p, 'estatisticas-segunda-parte');
  await Promise.all([p.waitForResponse((r) => r.url().includes('?parte=1')), escolher('parte-1')]);
  ok((await resumo()) === '6 | 3-1-2 | 14 | 11', `parte: «1.ª parte»: os 6 jogos, mas sem os golos da 2.ª parte do A (14 e 11) (${await resumo()})`);
  await escolher('parte-todas'); await escolher('parte-2');
  ok(pedidos.join(',') === ',?parte=2,?parte=1', `parte: voltar a uma parte já vista não pede outra vez (${pedidos})`);
  // Sem nenhum jogo com os filtros: diz-o, e os filtros ficam para voltar atrás
  await escolher('local-fora');
  ok((await p.locator('#sem-jogos-no-filtro').textContent()) === 'Nenhum jogo com estes filtros.' && (await p.locator('.filtros-estatisticas').count()) === 1 && (await p.locator('#tabela-estatisticas').count()) === 0,
    'filtros: sem nenhum jogo (2.ª parte, fora) diz «Nenhum jogo com estes filtros.» e os filtros continuam lá');
  ok((await p.locator('#exportar-excel').count()) === 0, 'excel: sem nenhum jogo não há Excel para descarregar');
  await escolher('local-todos'); await escolher('parte-todas');
  ok((await resumo()) === '6 | 3-1-2 | 15 | 12' && (await ativos()) === 'Todos|Jogo todo|Toda a época', 'filtros: voltar a tudo repõe os números do início');

  // O Excel leva o que os filtros deixam ver: a ligação acompanha-os e o ficheiro vem com o nome certo
  const excel = p.locator('#exportar-excel');
  const hrefExcel = async () => excel.getAttribute('href');
  const caminhoExcel = `/api/equipas/${propriaId}/estatisticas.xlsx`;
  ok((await hrefExcel()) === caminhoExcel && (await excel.textContent()) === '⬇ Excel' && (await excel.getAttribute('download')) !== null, `excel: sem filtros a ligação não leva parâmetros (${await hrefExcel()})`);
  await escolher('local-casa');
  ok((await hrefExcel()) === `${caminhoExcel}?local=casa`, `excel: «Em casa» acrescenta local=casa (${await hrefExcel()})`);
  await escolher('parte-2'); await escolher('ultimos-5');
  ok((await hrefExcel()) === `${caminhoExcel}?local=casa&parte=2&ultimos=5`, `excel: os três filtros vão na ligação (${await hrefExcel()})`);
  const [descarga] = await Promise.all([p.waitForEvent('download'), excel.click()]);
  ok(/^estatisticas-.+-em-casa-2-parte-ultimos-5-jogos\.xlsx$/.test(descarga.suggestedFilename()), `excel: o ficheiro diz a equipa e os filtros no nome (${descarga.suggestedFilename()})`);
  await descarga.saveAs(path.join(E2E_DIR, 'e2e-estatisticas-equipa.xlsx'));
  const bytesExcel = fs.readFileSync(path.join(E2E_DIR, 'e2e-estatisticas-equipa.xlsx'));
  ok(bytesExcel.length > 2000 && bytesExcel[0] === 0x50 && bytesExcel[1] === 0x4b, `excel: o ficheiro descarregado é um .xlsx (ZIP, ${bytesExcel.length} bytes)`);
  await escolher('parte-todas'); await escolher('ultimos-todos'); await escolher('local-todos');
  ok((await hrefExcel()) === caminhoExcel && (await ativos()) === 'Todos|Jogo todo|Toda a época', 'excel: voltar a tudo tira os parâmetros da ligação');

  // A evolução de um jogador (só com 2 jogos ou mais), na vista escolhida
  await p.locator('tr.linha-jogador', { hasText: 'Bruno Remata' }).locator('button.abrir-jogador').click();
  const graficoBruno = p.locator(`#grafico-jogador-${bruno}`);
  ok(await esperarPor(async () => (await graficoBruno.locator('.grafico-ponto').count()) === 6) && await graficoBruno.isVisible() && (await graficoBruno.locator('figcaption').textContent()).startsWith('Bruno Remata: ') && (await graficoBruno.locator('.grafico-legenda').count()) === 0,
    'jogador: abrir o Bruno mostra a evolução dele, jogo a jogo (6 jogos, uma série)');
  await captura(p, 'estatisticas-grafico-jogador');
  await p.locator('tr.linha-jogador', { hasText: 'Bruno Remata' }).locator('button.abrir-jogador').click();
  await p.locator('[aria-label="O que ver"] button', { hasText: 'Guarda-redes' }).click();
  await p.locator('tr.linha-jogador', { hasText: 'Nuno Guarda' }).locator('button.abrir-jogador').click();
  ok(await esperarPor(async () => (await p.locator(`#grafico-jogador-${guardaRedes} .grafico-ponto`).count()) === 2), 'jogador: o guarda-redes (2 jogos) tem o gráfico da percentagem de defesa');
  await p.locator('tr.linha-jogador', { hasText: 'Nuno Guarda' }).locator('button.abrir-jogador').click();

  // Num ecrã estreito nada passa para fora do ecrã
  await p.setViewportSize({ width: 390, height: 800 });
  await p.locator('[aria-label="O que ver"] button', { hasText: 'Ataque' }).click();
  await p.evaluate(() => window.scrollTo(0, 0));
  await aba('golos').click();
  await p.waitForTimeout(300);
  const larguras = await p.evaluate(() => ({ pagina: document.documentElement.scrollWidth, ecra: window.innerWidth, grafico: document.querySelector('#grafico-equipa .grafico-svg').getBoundingClientRect().right }));
  ok(larguras.pagina <= larguras.ecra && larguras.grafico <= larguras.ecra, `estreito: a página e o gráfico cabem num ecrã de 390 px (${JSON.stringify(larguras)})`);
  await captura(p, 'estatisticas-estreito');
  await p.close();

  // A API: ?parte=1|2 responde, outro valor é recusado
  const api = (parte) => ctx.request.get(`${servidor.url}/api/equipas/${propriaId}/estatisticas${parte}`);
  const segunda = await (await api('?parte=2')).json();
  ok((await api('?parte=2')).status() === 200 && segunda.jogos.length === 1 && segunda.jogos[0].golos === 1 && segunda.jogos[0].golosAdversario === 1, 'estatísticas (API): ?parte=2 só traz os jogos com registos na 2.ª parte e os golos dela');
  const mau = await api('?parte=3');
  ok(mau.status() === 400 && ((await mau.json()).erro ?? '').includes('1 ou 2'), 'estatísticas (API): ?parte=3 = 400 com a explicação');
  ok((await api('.xlsx?local=lado')).status() === 400 && (await api('.xlsx?ultimos=0')).status() === 400 && (await api('.xlsx?parte=3')).status() === 400, 'estatísticas (API): o Excel recusa filtros que não existem (400)');
  ok((await ctxVisitante.request.get(`${servidor.url}/api/equipas/${propriaId}/estatisticas.xlsx`)).status() === 401, 'estatísticas (API): o Excel sem sessão = 401');

  // Arrumar: os jogos e os eventos de mais saem, para os passos seguintes ficarem como estavam
  await q('DELETE FROM jogos WHERE id = ANY($1)', [[c1, c2, c3, c4]]);
  await q('DELETE FROM eventos WHERE jogo_id = $1 AND parte = 2', [jogoA]);
});

await passo('Relatório do adversário: o que explorar e o que travar, os números, os 7 metros, as defesas e as zonas', async () => {
  const [{ equipa_id: propriaId }] = await q('SELECT equipa_id FROM utilizadores WHERE id = $1', [donoId]);
  const [{ nome: nomePropria }] = await q('SELECT nome FROM equipas WHERE id = $1', [propriaId]);
  const nomeUrsos = `Ursos ${sufixo}`;
  const [{ id: ursos }] = await q('INSERT INTO equipas (nome, dono_id) VALUES ($1, $2) RETURNING id', [nomeUrsos, donoId]);
  const novoJogador = async (numero, nome, posicao) => (await q('INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo) VALUES ($1,$2,$3,$4) RETURNING id', [ursos, numero, nome, posicao]))[0].id;
  const grUrsos = await novoJogador(1, 'Nuno Viana', 'GR');
  const j7 = await novoJogador(7, 'Rui Costa', 'LE');
  const j9 = await novoJogador(9, 'Miguel Sousa', 'PV');
  const j11 = await novoJogador(11, 'Bruno Lopes', 'PD');
  const [{ id: dePropria }] = await q("SELECT id FROM jogadores WHERE equipa_id = $1 AND posicao_codigo <> 'GR' ORDER BY numero LIMIT 1", [propriaId]);
  const [{ id: deAguias }] = await q("SELECT id FROM jogadores WHERE equipa_id = $1 AND posicao_codigo <> 'GR' ORDER BY numero LIMIT 1", [aguias.id]);
  const novoJogo = async (casa, fora, dataHora) => (await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id, data_hora) VALUES ($1,$2,$3,$4) RETURNING id', [casa, fora, donoId, dataHora]))[0].id;

  // Pontos do campo (x, y) que dão cada corredor
  const PE = [10, 20], LE = [30, 50], CE = [50, 50], LD = [70, 50], PD = [90, 20];
  let segundo = 0;
  const evento = (jogoId, equipa, tipo, jogador, { resultado = null, situacao = 'POSICIONAL', gr = null, xy = CE, sistema = null, baliza = null } = {}) => q(
    `INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, guarda_redes_id, resultado, situacao, x, y, parte, segundo_jogo, baliza_x, baliza_y, sistema_defensivo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$12,$13)`,
    [jogoId, equipa, tipo, jogador, gr, resultado, situacao, resultado ? xy[0] : null, resultado ? xy[1] : null, (segundo += 10), baliza?.[0] ?? null, baliza?.[1] ?? null, sistema]);
  const lista = async (jogoId, equipa, jogador, resultados, opcoes = {}) => { for (const resultado of resultados) await evento(jogoId, equipa, 'REMATE', jogador, { resultado, ...opcoes }); };
  const varios = async (jogoId, equipa, jogador, tipo, n) => { for (let i = 0; i < n; i++) await evento(jogoId, equipa, tipo, jogador); };

  // J1 (01/10, Ursos em casa contra a minha equipa, 11–4) e J2 (08/10, Ursos fora nas Águias, 13–4)
  const j1 = await novoJogo(ursos, propriaId, '2026-10-01T18:00:00Z');
  const j2 = await novoJogo(aguias.id, ursos, '2026-10-08T18:00:00Z');
  // Ursos: o #7 marca 9 em 13 pelo lateral esquerdo, o #11 marca 8 em 9 (5 em contra-ataque), o #9 marca 7 em 11 (3 de 7 metros);
  // 32 remates, 24 golos (75%); o corredor central dá 11 golos
  await lista(j1, ursos, j7, ['GOLO', 'GOLO', 'GOLO', 'GOLO', 'GOLO', 'DEFESA', 'DEFESA'], { xy: LE, sistema: '6_0' });
  await lista(j1, ursos, j9, ['GOLO', 'GOLO', 'FORA'], { xy: PD, sistema: '6_0' });
  await lista(j1, ursos, j11, ['GOLO'], { xy: CE, sistema: '6_0' });
  await lista(j1, ursos, j9, ['GOLO', 'GOLO', 'GOLO'], { xy: CE, situacao: 'SETE_METROS', baliza: [85, 85] });
  await lista(j2, ursos, j7, ['GOLO', 'GOLO', 'GOLO', 'GOLO', 'DEFESA', 'DEFESA'], { xy: LE });
  await lista(j2, ursos, j9, ['GOLO', 'GOLO', 'FORA', 'FORA'], { xy: PD });
  await lista(j2, ursos, j11, ['GOLO', 'GOLO', 'DEFESA'], { xy: CE });
  await lista(j2, ursos, j11, ['GOLO', 'GOLO', 'GOLO', 'GOLO', 'GOLO'], { xy: CE, situacao: 'CONTRA_ATAQUE' });
  // Contra o guarda-redes dos Ursos: 8 golos e 2 defesas em 10 remates à baliza (20%); 6 golos em cima à esquerda; os golos vêm de todos os corredores
  const contra = async (jogoId, equipa, jogador, sistema) => {
    const golos = [[PE, [15, 15]], [LE, [15, 15]], [CE, [15, 15]], [LD, [85, 85]]];
    for (const [xy, baliza] of golos) await evento(jogoId, equipa, 'REMATE', jogador, { resultado: 'GOLO', gr: grUrsos, xy, baliza, sistema });
    await evento(jogoId, equipa, 'REMATE', jogador, { resultado: 'DEFESA', gr: grUrsos, xy: CE, baliza: [50, 50], sistema });
  };
  await contra(j1, propriaId, dePropria, '5_1');
  // No J2 os golos vêm por outros corredores (a ponta direita no lugar da esquerda) e o 4.º golo cai em baixo à direita
  for (const [xy, baliza] of [[PD, [15, 15]], [LE, [15, 15]], [CE, [15, 15]], [LD, [85, 85]]]) {
    await evento(j2, aguias.id, 'REMATE', deAguias, { resultado: 'GOLO', gr: grUrsos, xy, baliza });
  }
  await evento(j2, aguias.id, 'REMATE', deAguias, { resultado: 'DEFESA', gr: grUrsos, xy: CE, baliza: [50, 50] });
  // Outros eventos dos Ursos: 22 perdas de bola (11 por jogo) e 7 exclusões (3,5 por jogo)
  await varios(j1, ursos, j7, 'PERDA_BOLA', 12); await varios(j2, ursos, j9, 'PERDA_BOLA', 10);
  await varios(j1, ursos, j9, 'DOIS_MINUTOS', 4); await varios(j2, ursos, j11, 'DOIS_MINUTOS', 3);
  // Uma equipa sem nenhum jogo registado
  const [{ id: semJogos }] = await q('INSERT INTO equipas (nome, dono_id) VALUES ($1, $2) RETURNING id', [`Sem jogos ${sufixo}`, donoId]);

  const limpo = async (locator) => ((await locator.innerText()) ?? '').replace(/\s+/g, ' ').trim();
  const todosOsTextos = async (locator) => (await locator.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());

  // A API devolve o que as contas precisam
  const resposta = await ctx.request.get(`${servidor.url}/api/equipas/${ursos}/adversario`);
  const api = await resposta.json();
  ok(resposta.status() === 200 && api.nome === nomeUrsos && api.jogadores.length === 4 && api.jogos.length === 2 && api.remates.length === 42 && api.outrosEventos.length === 4,
    `adversário (API): nome, 4 jogadores, 2 jogos, 42 remates (32 dos Ursos e 10 contra) e 4 linhas de outros eventos (${resposta.status()} ${api.jogadores?.length}/${api.jogos?.length}/${api.remates?.length}/${api.outrosEventos?.length})`);
  const exemplo = api.remates.find((r) => r.equipaId === ursos && r.situacao === 'SETE_METROS');
  ok(exemplo && exemplo.jogoId === j1 && exemplo.jogadorNumero === 9 && exemplo.balizaZona === 'BAIXO_DIR' && exemplo.corredor === 'CENTRAL', 'adversário (API): cada remate traz o jogo, o jogador, o corredor e a zona da baliza');
  ok(api.remates.filter((r) => r.equipaId !== ursos).every((r) => r.guardaRedesId === grUrsos), 'adversário (API): os remates dos adversários dizem que guarda-redes dos Ursos os defendeu');
  ok(!api.outrosEventos.some((o) => /SETE_SEIS/.test(o.tipo)) && api.outrosEventos.find((o) => o.jogoId === j1 && o.tipo === 'PERDA_BOLA')?.total === 12, 'adversário (API): as perdas de bola vêm contadas por jogo');
  ok((await ctx.request.get(`${servidor.url}/api/equipas/999999/adversario`)).status() === 404, 'adversário (API): uma equipa que não existe dá 404');
  ok((await ctxVisitante.request.get(`${servidor.url}/api/equipas/${ursos}/adversario`)).status() === 401, 'adversário (API): sem sessão = 401');
  const vazia = await (await ctx.request.get(`${servidor.url}/api/equipas/${semJogos}/adversario`)).json();
  ok(vazia.jogos.length === 0 && vazia.remates.length === 0 && vazia.jogadores.length === 0, 'adversário (API): uma equipa sem jogos responde com listas vazias');

  // Atalhos: a página das equipas (só nos adversários) e a convocatória
  const eq = await pagina(`/equipas.html?equipa=${ursos}`);
  await eq.waitForSelector('#relatorio-adversario:not([hidden])');
  ok((await eq.locator('#relatorio-adversario').getAttribute('href')) === `adversario.html?equipa=${ursos}`, 'adversário: na página das equipas, o adversário aberto tem a ligação «Relatório do adversário»');
  await eq.locator('.item-equipa', { hasText: nomePropria }).first().click();
  await eq.waitForSelector('#relatorio-adversario', { state: 'hidden' });
  ok(await eq.locator('#relatorio-adversario').isHidden(), 'adversário: na equipa da conta a ligação do relatório não aparece');
  await eq.close();
  const conv = await pagina(`/convocatoria.html?jogo=${j1}`);
  await conv.waitForSelector('[data-acao="relatorio-adversario"]');
  const hrefs = await conv.locator('[data-acao="relatorio-adversario"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  ok(hrefs.length === 2 && hrefs.includes(`adversario.html?equipa=${ursos}`) && hrefs.includes(`adversario.html?equipa=${propriaId}`), `adversário: a convocatória leva ao relatório de cada equipa (${hrefs})`);
  await conv.close();

  // A página: os pontos, por ordem de peso
  const p = await pagina(`/adversario.html?equipa=${ursos}`);
  await p.waitForSelector('#folha-adversario #bloco-explorar');
  ok(await limpo(p.locator('#adversario-nome')) === nomeUrsos && (await limpo(p.locator('#adversario-base'))) === `Baseado em 2 jogos registados (1 contra ${nomePropria}).`,
    `adversário: o título é a equipa e diz em quantos jogos se baseia (${await limpo(p.locator('#adversario-base'))})`);
  ok((await p.locator('.folha .aviso-inline').count()) === 0, 'adversário: com 32 remates não há aviso de poucos dados');
  const pontos = async (bloco) => (await p.locator(`#bloco-${bloco} li`).evaluateAll((lis) => lis.map((li) => li.dataset.ponto))).join('|');
  ok(await pontos('explorar') === 'gr_fraco|exclusoes|perdas', `adversário: a explorar — guarda-redes fraco, exclusões e perdas de bola (${await pontos('explorar')})`);
  ok(await pontos('travar') === 'corredor_forte|jogador_perigoso|finalizacao_boa', `adversário: a travar — o corredor central, o #7 e a finalização (${await pontos('travar')})`);
  const gr = await limpo(p.locator('[data-ponto="gr_fraco"]'));
  ok(gr.includes('Rematar à baliza contra o #1 Nuno Viana') && gr.includes('2 defesas em 10 remates à baliza (20%)') && gr.includes('alto à esquerda (6 de 8 golos)'), `adversário: o guarda-redes fraco diz a percentagem e onde cede (${gr})`);
  const central = await limpo(p.locator('[data-ponto="corredor_forte"]'));
  ok(central.includes('Fechar o central') && central.includes('11 dos 24 golos vêm do central'), `adversário: o corredor de onde marcam (${central})`);
  ok((await limpo(p.locator('[data-ponto="jogador_perigoso"]'))).includes('Marcar de perto o #7 Rui Costa'), 'adversário: o jogador a marcar de perto');
  ok(await p.locator('#bloco-explorar ol').getAttribute('class') === 'pontos explorar' && await p.locator('#bloco-travar ol').getAttribute('class') === 'pontos travar', 'adversário: os pontos a explorar e a travar têm cores diferentes (classes próprias)');

  // Os números
  const numeros = Object.fromEntries((await p.locator('#bloco-numeros tbody tr').evaluateAll((trs) => trs.map((tr) => [tr.cells[0].textContent, tr.cells[1].textContent]))));
  ok(numeros['Jogos (vitórias-empates-derrotas)'] === '2 (2-0-0)' && numeros['Golos marcados por jogo'] === '12,0' && numeros['Golos sofridos por jogo'] === '4,0', `adversário: jogos e golos por jogo (${JSON.stringify(numeros).slice(0, 160)})`);
  ok(numeros['Remates por jogo'] === '16,0' && numeros['Eficácia de remate'] === '75%' && numeros['Eficácia dos adversários contra eles'] === '80%' && numeros['Defesas dos guarda-redes'] === '2 em 10 (20%)', 'adversário: remates por jogo, eficácia dos Ursos e dos adversários, defesas do guarda-redes');
  ok(numeros['Perdas de bola por jogo'] === '11,0' && numeros['Exclusões de 2 minutos por jogo'] === '3,5' && numeros['Golos de contra-ataque por jogo'] === '2,5' && numeros['7 metros (golos / lançamentos)'] === '3/3', 'adversário: perdas, exclusões, contra-ataque e 7 metros por jogo');

  // Quem marca, 7 metros, defesas, guarda-redes, zonas e jogos
  const jogadores = await p.locator('#bloco-jogadores tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent).join('|')));
  ok(jogadores.join(' ; ') === '#7 Rui Costa|Lateral esquerdo|9|13|69%|– ; #11 Bruno Lopes|Ponta direita|8|9|89%|– ; #9 Miguel Sousa|Pivot|7|10|70%|3', `adversário: quem marca, do que mais marca para o que menos (${jogadores.join(' ; ')})`);
  const sete = await limpo(p.locator('#bloco-sete-metros'));
  ok(sete.includes('#9 Miguel Sousa 3 3 0 baixo à direita (3 de 3)') && sete.includes('Lançaram 3 e marcaram 3. Sofreram 0 e defenderam 0.'), `adversário: o livro dos 7 metros (${sete})`);
  const defesas = await limpo(p.locator('#bloco-defesas'));
  ok(defesas.includes('O ataque deles contra cada defesa') && defesas.includes('6:0 11 8 73%') && defesas.includes('A defesa que jogam') && defesas.includes('5:1 5 4 80% 100%'), `adversário: o ataque contra a 6:0 e a defesa 5:1 que eles jogam (${defesas})`);
  ok((await limpo(p.locator('#bloco-guarda-redes tbody tr'))) === '#1 Nuno Viana 10 2 20%', 'adversário: o guarda-redes, com os remates à baliza e a % de defesa');
  const corredores = await p.locator('#bloco-zonas tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent).join('|')));
  ok(corredores.join(' ; ') === 'Ponta esquerda|0|1 ; Lateral esquerdo|9|2 ; Central|11|2 ; Lateral direito|0|2 ; Ponta direita|4|1', `adversário: golos marcados e sofridos por corredor (${corredores.join(' ; ')})`);
  const jogos = await todosOsTextos(p.locator('#bloco-jogos li'));
  ok(jogos.length === 2 && jogos[0] === `V 08/10/2026 · fora contra Águias do Norte 13–4` && jogos[1] === `V 01/10/2026 · em casa contra ${nomePropria} 11–4`, `adversário: os jogos usados, o mais recente primeiro (${jogos.join(' ; ')})`);
  await captura(p, 'adversario-relatorio');

  // Só os jogos contra a minha equipa: 1 jogo e poucos dados
  await p.click('[data-filtro="jogos-nos"]');
  await p.waitForSelector('[data-filtro="jogos-nos"].ativo');
  ok((await limpo(p.locator('#adversario-base'))) === `Baseado em 1 jogo contra ${nomePropria}.` && (await p.locator('#bloco-jogos li').count()) === 1, 'adversário: «Só contra a minha equipa» usa só esse jogo');
  ok((await limpo(p.locator('.folha .aviso-inline'))) === 'Só 14 remates registados em 1 jogo: os pontos podem enganar.', 'adversário: com 14 remates avisa que os pontos podem enganar');
  ok(new URL(p.url()).searchParams.get('contra') === 'nos' && new URL(p.url()).searchParams.get('equipa') === String(ursos), 'adversário: o endereço guarda a equipa e o filtro');
  await p.click('[data-filtro="jogos-todos"]');
  await p.waitForSelector('[data-filtro="jogos-todos"].ativo');
  ok((await p.locator('.folha .aviso-inline').count()) === 0 && (await p.locator('#bloco-jogos li').count()) === 2, 'adversário: «Todos» volta aos 2 jogos');

  // Copiar como texto e imprimir
  await p.click('#copiar');
  const copiado = await p.evaluate(() => navigator.clipboard.readText());
  const linhasCopiadas = copiado.split('\n');
  ok(linhasCopiadas[0] === `Relatório do adversário · ${nomeUrsos}` && linhasCopiadas[1] === `Baseado em 2 jogos registados (1 contra ${nomePropria}).`, `adversário: o texto copiado começa pela equipa e pelos jogos (${linhasCopiadas.slice(0, 2)})`);
  ok(copiado.includes('A explorar:\n1. Rematar à baliza contra o #1 Nuno Viana') && copiado.includes('A travar:\n1. Fechar o central') && copiado.includes('Quem marca:\n#7 Rui Costa: 9 golos em 13 remates (69%)'), 'adversário: o texto copiado leva os pontos, os números e quem marca');
  ok(((await p.locator('#aviso').textContent()) ?? '').includes('Texto copiado'), 'adversário: avisa que o texto foi copiado');
  await p.emulateMedia({ media: 'print' });
  ok(await p.locator('.topo').isHidden() && await p.locator('#escolhas-adversario').isHidden() && await p.locator('.cabeca-relatorio').isHidden() && await p.locator('.folha').isVisible(), 'adversário: ao imprimir só fica a folha');
  await p.emulateMedia({ media: 'screen' });

  // Outra equipa no seletor, a equipa da conta (sem o filtro dos jogos) e uma equipa sem jogos
  ok((await p.locator('#escolher-equipa').inputValue()) === String(ursos) && (await p.locator('#escolher-equipa option', { hasText: '(a minha equipa)' }).count()) === 1, 'adversário: o seletor tem a equipa escolhida e marca a minha equipa');
  await p.selectOption('#escolher-equipa', String(leoes.id));
  await p.waitForFunction(() => document.querySelector('#adversario-nome')?.textContent.startsWith('Leões'), null, { timeout: 5000 });
  ok(new URL(p.url()).searchParams.get('equipa') === String(leoes.id), 'adversário: escolher outra equipa muda o relatório e o endereço');
  await p.selectOption('#escolher-equipa', String(propriaId));
  await p.waitForFunction((n) => document.querySelector('#adversario-nome')?.textContent === n, nomePropria, { timeout: 5000 });
  ok((await p.locator('[data-filtro="jogos-nos"]').count()) === 0, 'adversário: no relatório da minha equipa não há o filtro «Só contra a minha equipa»');
  await p.selectOption('#escolher-equipa', String(semJogos));
  await p.waitForFunction((n) => document.querySelector('#adversario-nome')?.textContent === n, `Sem jogos ${sufixo}`, { timeout: 5000 });
  ok((await limpo(p.locator('.folha .vazio'))).startsWith('Ainda não há jogos registados desta equipa.') && (await p.locator('#bloco-explorar').count()) === 0 && (await limpo(p.locator('#adversario-base'))) === 'Sem jogos registados.',
    'adversário: uma equipa sem jogos diz que ainda não há jogos registados (e não inventa pontos)');
  await p.close();

  // Uma equipa que não é desta conta (ou que não existe) abre a primeira adversária
  const estranha = await pagina('/adversario.html?equipa=999999');
  await estranha.waitForSelector('#adversario-nome');
  ok(await estranha.locator('#escolher-equipa').inputValue() !== '999999', 'adversário: uma equipa que não existe no endereço abre outra equipa da conta');
  await estranha.close();

  // Arrumar: os jogos e as equipas de mais saem, para os passos seguintes ficarem como estavam
  await q('DELETE FROM jogos WHERE id = ANY($1)', [[j1, j2]]);
  await q('DELETE FROM jogadores WHERE equipa_id = $1', [ursos]);
  await q('DELETE FROM equipas WHERE id = ANY($1)', [[ursos, semJogos]]);
});

await passo('Jogos: corrigir (adversário, casa ou fora, data e local), terminar (o banco fecha o registo) e apagar', async () => {
  const [{ equipa_id: propriaId }] = await q('SELECT equipa_id FROM utilizadores WHERE id = $1', [donoId]);
  const [{ nome: nomePropria }] = await q('SELECT nome FROM equipas WHERE id = $1', [propriaId]);
  const localA = `Pavilhão A ${sufixo}`;
  const localB = `Pavilhão B ${sufixo}`;
  const novoJogo = async (casa, fora, local, dataHora) => (await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id, local, data_hora) VALUES ($1,$2,$3,$4,$5) RETURNING id', [casa, fora, donoId, local, dataHora]))[0];
  const jogoA = await novoJogo(propriaId, aguias.id, localA, '2026-10-10T18:00:00Z');   // ainda sem eventos
  const jogoB = await novoJogo(propriaId, leoes.id, localB, '2026-10-11T18:00:00Z');    // com um golo
  const [meu] = await q('SELECT id FROM jogadores WHERE equipa_id = $1 ORDER BY numero LIMIT 1', [propriaId]);
  const [deles] = await q('SELECT id FROM jogadores WHERE equipa_id = $1 ORDER BY numero LIMIT 1', [aguias.id]);
  await q('INSERT INTO convocados (jogo_id, jogador_id) VALUES ($1,$2), ($1,$3)', [jogoA.id, meu.id, deles.id]);
  await q("INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, resultado, situacao, x, y, parte, segundo_jogo) VALUES ($1,$2,'REMATE',$3,'GOLO','POSICIONAL',50,40,1,60)", [jogoB.id, propriaId, meu.id]);
  const jogoNaBase = async (id) => (await q('SELECT j.*, c.nome AS casa_nome, f.nome AS fora_nome FROM jogos j JOIN equipas c ON c.id = j.equipa_casa_id JOIN equipas f ON f.id = j.equipa_fora_id WHERE j.id = $1', [id]))[0];

  const p = await pagina('/');
  const linha = (local) => p.locator('.jogo-linha', { hasText: local });
  const botoes = async (local) => (await linha(local).locator('.acoes-jogo button[data-acao]').evaluateAll((b) => b.map((x) => x.dataset.acao))).join();
  await linha(localA).waitFor();
  ok((await botoes(localA)) === 'editar,terminar,apagar' && (await linha(localA).locator('.etiqueta.terminado').count()) === 0, `jogos: cada jogo tem Editar, Terminar jogo e Apagar (${await botoes(localA)})`);
  await captura(p, 'jogos-acoes');

  // Corrigir um jogo sem eventos: adversário novo, fora de casa, outra data e outro local
  await linha(localA).locator('button[data-acao="editar"]').click();
  const form = linha(localA).locator('form.editar-jogo');
  const valores = async (f) => [await f.locator('[data-campo="adversario"]').inputValue(), await f.locator('[data-campo="lado"]').inputValue(), await f.locator('[data-campo="data"]').inputValue(), await f.locator('[data-campo="local"]').inputValue()];
  ok(JSON.stringify(await valores(form)) === JSON.stringify(['Águias do Norte', 'casa', '2026-10-10T18:00', localA]), `jogos: o formulário abre com o que o jogo tem (${await valores(form)})`);
  const adversarioNovo = `Falcões ${sufixo}`;
  const novoLocalA = `Pavilhão Novo ${sufixo}`;
  await form.locator('[data-campo="adversario"]').fill(adversarioNovo);
  await form.locator('[data-campo="lado"]').selectOption('fora');
  await form.locator('[data-campo="data"]').fill('2026-12-05T20:00');
  await form.locator('[data-campo="local"]').fill(novoLocalA);
  await form.locator('button[type=submit]').click();
  await linha(novoLocalA).waitFor();
  let a = await jogoNaBase(jogoA.id);
  ok(a.casa_nome === adversarioNovo && a.equipa_fora_id === propriaId && a.local === novoLocalA && new Date(a.data_hora).toISOString() === '2026-12-05T20:00:00.000Z',
    `jogos: o jogo ficou com o adversário novo (criado), a equipa da conta fora, a data e o local (${a.casa_nome} vs ${a.fora_nome}, ${a.local})`);
  ok(((await linha(novoLocalA).locator('.equipas').textContent()) ?? '').includes(adversarioNovo) && ((await linha(novoLocalA).locator('.meta').textContent()) ?? '').includes('20:00'),
    'jogos: a lista mostra o jogo corrigido (adversário e hora)');
  ok((await q('SELECT jogador_id FROM convocados WHERE jogo_id = $1', [jogoA.id])).map((x) => x.jogador_id).join() === String(meu.id), 'jogos: ao mudar de adversário saem da convocatória os jogadores do adversário que saiu');
  ok(await p.evaluate(() => [...document.querySelectorAll('#adversarios option')].some((o) => o.value.startsWith('Falcões'))), 'jogos: o adversário novo passa a ser sugerido no formulário de novo jogo');

  // Um jogo com eventos: trocar casa e fora pode-se, mudar de adversário não
  await linha(localB).locator('button[data-acao="editar"]').click();
  const formB = linha(localB).locator('form.editar-jogo');
  await formB.locator('[data-campo="adversario"]').fill(adversarioNovo);
  await formB.locator('button[type=submit]').click();
  await formB.locator('.erro-formulario', { hasText: 'já tem eventos' }).waitFor();
  ok((await jogoNaBase(jogoB.id)).equipa_fora_id === leoes.id, 'jogos: com eventos registados não se muda de adversário (409, nada muda)');
  await formB.locator('[data-campo="adversario"]').fill('Leões do Sul');
  await formB.locator('[data-campo="lado"]').selectOption('fora');
  await formB.locator('button[type=submit]').click();
  await p.waitForFunction(() => !document.querySelector('form.editar-jogo'));
  const b = await jogoNaBase(jogoB.id);
  ok(b.casa_nome === 'Leões do Sul' && b.equipa_fora_id === propriaId, 'jogos: com eventos registados dá para passar a jogar fora (a equipa da conta e o adversário trocam)');
  ok(((await q('SELECT count(*)::int AS n FROM eventos WHERE jogo_id = $1', [jogoB.id]))[0].n) === 1, 'jogos: e os eventos continuam lá');

  // Terminar o jogo A: etiqueta na lista e «Reabrir»
  await linha(novoLocalA).locator('button[data-acao="terminar"]').click();
  await linha(novoLocalA).locator('.etiqueta.terminado').waitFor();
  ok((await botoes(novoLocalA)) === 'editar,reabrir,apagar' && (await jogoNaBase(jogoA.id)).terminado_em !== null, `jogos: terminar marca o jogo e a lista passa a oferecer «Reabrir» (${await botoes(novoLocalA)})`);

  // O banco de um jogo terminado fica fechado, e reabre-se (ou termina-se) dali
  const banco = await pagina(`/banco.html?jogo=${jogoA.id}`);
  await banco.waitForSelector('#faixa-terminado:not([hidden])');
  ok(await banco.locator('#btn-terminar').isHidden() && (await banco.locator('main.banco.fechado').count()) === 1, 'banco: um jogo terminado mostra a faixa «Jogo terminado», esconde «Terminar jogo» e fecha o registo');
  await captura(banco, 'banco-terminado');
  await banco.click('#btn-reabrir');
  await banco.waitForSelector('#faixa-terminado', { state: 'hidden' });
  ok(await banco.locator('#btn-terminar').isVisible() && (await banco.locator('main.banco.fechado').count()) === 0 && (await jogoNaBase(jogoA.id)).terminado_em === null, 'banco: reabrir volta a abrir o registo (e a base de dados fica sem fim de jogo)');
  await banco.click('#btn-terminar');
  await banco.waitForSelector('#faixa-terminado:not([hidden])');
  ok((await jogoNaBase(jogoA.id)).terminado_em !== null, 'banco: «Terminar jogo» marca o fim do jogo');
  await banco.close();

  // O dashboard diz que o jogo terminou (e deixa de dizer quando se reabre)
  const dash = await pagina(`/dashboard.html?jogo=${jogoA.id}`);
  await empurrar(dash, jogoA.id);
  ok(await esperarPor(async () => await dash.locator('#terminado-dash').isVisible()), 'dashboard: um jogo terminado mostra «Jogo terminado»');
  await linha(novoLocalA).locator('button[data-acao="reabrir"]').click();
  await linha(novoLocalA).locator('button[data-acao="terminar"]').waitFor();
  await empurrar(dash, jogoA.id);
  ok(await esperarPor(async () => await dash.locator('#terminado-dash').isHidden()), 'dashboard: reabrir o jogo tira o «Jogo terminado»');
  await dash.close();

  // Apagar: o jogo sai da lista e leva os eventos e a convocatória
  await linha(novoLocalA).locator('button[data-acao="apagar"]').click();
  await p.waitForFunction((t) => ![...document.querySelectorAll('.jogo-linha')].some((l) => l.textContent.includes(t)), novoLocalA);
  ok((await q('SELECT 1 FROM jogos WHERE id = $1', [jogoA.id])).length === 0 && (await q('SELECT 1 FROM convocados WHERE jogo_id = $1', [jogoA.id])).length === 0, 'jogos: apagar tira o jogo e a convocatória');
  await linha(localB).locator('button[data-acao="apagar"]').click();
  await p.waitForFunction((t) => ![...document.querySelectorAll('.jogo-linha')].some((l) => l.textContent.includes(t)), localB);
  ok((await q('SELECT 1 FROM jogos WHERE id = $1', [jogoB.id])).length === 0 && (await q('SELECT 1 FROM eventos WHERE jogo_id = $1', [jogoB.id])).length === 0, 'jogos: apagar um jogo com eventos leva os eventos (e o resultado deixa de contar)');
  ok(((await q('SELECT 1 FROM jogos WHERE id = 2')).length) === 1, 'jogos: os outros jogos ficam como estavam');
  await p.close();
});

await passo('Eventos: ver todos, filtrar, corrigir (resultado, jogador, sítio, equipa, minuto) e apagar', async () => {
  const [{ equipa_id: propriaId }] = await q('SELECT equipa_id FROM utilizadores WHERE id = $1', [donoId]);
  const meus = await q("SELECT id, numero, nome FROM jogadores WHERE equipa_id = $1 AND posicao_codigo <> 'GR' ORDER BY numero LIMIT 2", [propriaId]);
  const [delesJogador] = await q("SELECT id, numero, nome FROM jogadores WHERE equipa_id = $1 AND posicao_codigo <> 'GR' ORDER BY numero LIMIT 1", [aguias.id]);
  let [delesGr] = await q("SELECT id, numero, nome FROM jogadores WHERE equipa_id = $1 AND posicao_codigo = 'GR' ORDER BY numero LIMIT 1", [aguias.id]);
  if (!delesGr) [delesGr] = await q("INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo) VALUES ($1, 98, 'Guarda Eventos', 'GR') RETURNING id, numero, nome", [aguias.id]);
  const localC = `Pavilhão Eventos ${sufixo}`;
  const [jogoC] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id, local, data_hora) VALUES ($1,$2,$3,$4,$5) RETURNING id', [propriaId, aguias.id, donoId, localC, '2026-10-12T18:00:00Z']);
  const novo = async (equipa, tipo, jogador, { resultado = null, situacao = 'POSICIONAL', parte = 1, segundo = 0, x = null, y = null, guardaRedes = null } = {}) => (await q(
    `INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, guarda_redes_id, resultado, situacao, x, y, parte, segundo_jogo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [jogoC.id, equipa, tipo, jogador, guardaRedes, resultado, situacao, x, y, parte, segundo]))[0].id;
  // 1.ª parte: um remate fora e uma defesa do nosso guarda-redes... 2.ª parte: uma perda de bola e 2 minutos do adversário
  const remateFora = await novo(propriaId, 'REMATE', meus[0].id, { resultado: 'FORA', x: 50, y: 40, segundo: 120, guardaRedes: delesGr.id });
  const remateDefesa = await novo(aguias.id, 'REMATE', delesJogador.id, { resultado: 'DEFESA', x: 30, y: 30, segundo: 300, situacao: 'CONTRA_ATAQUE' });
  const perda = await novo(propriaId, 'PERDA_BOLA', meus[0].id, { parte: 2, segundo: 1900 });
  const doisMin = await novo(aguias.id, 'DOIS_MINUTOS', delesJogador.id, { parte: 2, segundo: 2100 });
  const evento = async (id) => (await q('SELECT * FROM eventos WHERE id = $1', [id]))[0];

  // O jogo tem a ligação «Eventos» e o banco tem «Ver todos os eventos»
  const lista = await pagina('/');
  const linhaJogo = lista.locator('.jogo-linha', { hasText: localC });
  await linhaJogo.waitFor();
  ok((await linhaJogo.locator('a[data-acao="eventos"]').getAttribute('href')) === `eventos.html?jogo=${jogoC.id}`, 'eventos: a lista de jogos tem a ligação «Eventos»');
  await lista.close();
  const banco = await pagina(`/banco.html?jogo=${jogoC.id}`);
  ok((await banco.locator('#ver-todos-eventos').getAttribute('href')) === `eventos.html?jogo=${jogoC.id}`, 'eventos: o banco liga a «Ver todos os eventos e corrigir»');
  await banco.close();

  // A lista: todos os eventos, os mais recentes primeiro
  const p = await pagina(`/eventos.html?jogo=${jogoC.id}`);
  await p.waitForSelector('#tabela-eventos');
  const ids = async () => p.locator('#tabela-eventos tbody tr').evaluateAll((l) => l.map((x) => Number(x.dataset.eventoId)));
  const linha = (id) => p.locator(`#tabela-eventos tr[data-evento-id="${id}"]`);
  ok(JSON.stringify(await ids()) === JSON.stringify([doisMin, perda, remateDefesa, remateFora]), `eventos: a lista traz os 4 eventos, os mais recentes primeiro (${await ids()})`);
  ok((await texto(p.locator('#resultado-eventos'))) === '0–0', 'eventos: o resultado do jogo vem dos golos (ainda 0–0)');
  ok((await texto(linha(remateFora))).includes('1.ª02:00') && (await texto(linha(remateFora))).includes('Fora') && (await texto(linha(remateFora))).includes(`#${meus[0].numero}`), 'eventos: cada linha diz a parte, o minuto, o resultado e o jogador');
  ok((await texto(linha(remateDefesa))).includes('Contra-ataque'), 'eventos: e os detalhes do remate (a situação)');
  ok((await texto(linha(doisMin))).includes('2minutos') && (await texto(linha(doisMin))).includes('2.ª35:00'), 'eventos: também os eventos que não são remates');
  await captura(p, 'eventos-lista');

  // Os filtros
  await p.click('[data-filtro="grupo-remates"]');
  ok(JSON.stringify(await ids()) === JSON.stringify([remateDefesa, remateFora]), 'eventos: filtro «Remates»');
  await p.click('[data-filtro="equipa-fora"]');
  ok(JSON.stringify(await ids()) === JSON.stringify([remateDefesa]), 'eventos: filtro da equipa de fora (só remates dela)');
  await p.click('[data-filtro="equipa-todas"]');
  await p.click('[data-filtro="grupo-outros"]');
  await p.click('[data-filtro="parte-2"]');
  ok(JSON.stringify(await ids()) === JSON.stringify([doisMin, perda]), 'eventos: filtro «Outros eventos» na 2.ª parte');
  await p.click('[data-filtro="parte-1"]');
  ok(await p.locator('#tabela-eventos').count() === 0 && (await texto(p.locator('#contagem-eventos'))).includes('0de4'), 'eventos: sem resultados diz-se «0 de 4» e não há tabela');
  await p.click('[data-filtro="grupo-todos"]');
  await p.click('[data-filtro="parte-todas"]');
  await p.selectOption('[data-filtro="jogador"]', String(delesJogador.id));
  ok(JSON.stringify(await ids()) === JSON.stringify([doisMin, remateDefesa]), 'eventos: filtro por jogador');
  await p.selectOption('[data-filtro="jogador"]', '');
  ok((await ids()).length === 4, 'eventos: tirar os filtros mostra tudo outra vez');

  // Corrigir o remate fora: é golo, de outro jogador, de outro sítio, com local na baliza, ao minuto 3:05
  await linha(remateFora).locator('button[data-acao="corrigir"]').click();
  const janela = p.locator('#janela-evento .janela-evento');
  await janela.waitFor();
  const campo = (nome) => janela.locator(`[data-campo="${nome}"]`);
  ok((await campo('guardar').isDisabled()) && (await campo('minuto').inputValue()) === '02:00' && (await campo('jogador').inputValue()) === String(meus[0].id), 'eventos: a janela abre com o evento tal como está e «Guardar» desligado');
  ok((await janela.locator('.evento-baliza').isHidden()), 'eventos: num remate fora não há baliza');
  ok((await campo('guarda-redes').inputValue()) === String(delesGr.id), 'eventos: o guarda-redes do adversário vem escolhido');
  await captura(p, 'eventos-corrigir');
  await janela.locator('button[data-resultado="GOLO"]').click();
  await janela.locator('.evento-baliza').waitFor({ state: 'visible' });
  ok(await campo('guardar').isEnabled(), 'eventos: mudar o resultado liga o «Guardar»');
  await janela.locator('svg.baliza').click({ position: { x: 300, y: 40 } });
  await campo('jogador').selectOption(String(meus[1].id));
  await campo('minuto').fill('3:05');
  await campo('parte').first().click();
  const caixa = await janela.locator('svg.campo').boundingBox();
  await janela.locator('svg.campo').click({ position: { x: caixa.width / 2, y: caixa.height / 2 } });
  await campo('guardar').click();
  await janela.waitFor({ state: 'detached' });
  await p.waitForFunction(() => document.getElementById('resultado-eventos')?.textContent.replace(/\s/g, '') === '1–0');
  let e = await evento(remateFora);
  ok(e.resultado === 'GOLO' && e.jogador_id === meus[1].id && e.segundo_jogo === 185 && e.parte === 1, `eventos: o remate ficou golo, de outro jogador, aos 3:05 (${e.resultado} ${e.jogador_id} ${e.segundo_jogo})`);
  ok(Number(e.y) > 45 && Number(e.y) < 52 && Number(e.x) > 47 && Number(e.x) < 53, `eventos: o sítio do remate mudou para onde se tocou no mapa (${e.x}, ${e.y})`);
  ok(e.baliza_x !== null && e.baliza_zona !== null && e.guarda_redes_id === delesGr.id, `eventos: o golo tem o local na baliza (${e.baliza_zona}) e continua contra o mesmo guarda-redes`);
  ok((await texto(linha(remateFora))).includes('Golo') && (await texto(linha(remateFora))).includes(`#${meus[1].numero}`), 'eventos: a lista mostra o evento corrigido, e o resultado do jogo passa a 1–0');

  // Voltar a pôr fora: o local na baliza deixa de existir e o minuto não muda se não se mexer
  await linha(remateFora).locator('button[data-acao="corrigir"]').click();
  await janela.waitFor();
  ok((await campo('minuto').inputValue()) === '03:05' && (await janela.locator('.evento-baliza').isVisible()), 'eventos: o golo corrigido abre com o minuto e a baliza');
  await janela.locator('button[data-resultado="POSTE"]').click();
  await campo('guardar').click();
  await p.waitForFunction(() => document.getElementById('resultado-eventos')?.textContent.replace(/\s/g, '') === '0–0');
  e = await evento(remateFora);
  ok(e.resultado === 'POSTE' && e.baliza_x === null && e.baliza_y === null && e.baliza_zona === null, 'eventos: num poste já não há local na baliza');

  // A defesa do adversário (contra-ataque) passa a ser posicional contra uma defesa 6:0; e o remate passa à outra equipa
  await linha(remateDefesa).locator('button[data-acao="corrigir"]').click();
  await janela.waitFor();
  ok(await campo('sistema').isHidden(), 'eventos: num contra-ataque não se pergunta a defesa do adversário');
  await campo('situacao').selectOption('POSICIONAL');
  await campo('sistema').selectOption('6_0');
  await campo('guardar').click();
  await janela.waitFor({ state: 'hidden' });
  e = await evento(remateDefesa);
  ok(e.situacao === 'POSICIONAL' && e.sistema_defensivo === '6_0', 'eventos: o remate passou a posicional contra uma defesa 6:0');
  await linha(remateDefesa).locator('button[data-acao="corrigir"]').click();
  await janela.waitFor();
  await campo('situacao').selectOption('SETE_METROS');
  await campo('guardar').click();
  await janela.waitFor({ state: 'hidden' });
  e = await evento(remateDefesa);
  ok(e.situacao === 'SETE_METROS' && e.sistema_defensivo === null, 'eventos: num 7 metros a defesa do adversário deixa de existir');

  // Um evento que não é remate: passa à outra equipa e a outro tipo
  await linha(perda).locator('button[data-acao="corrigir"]').click();
  await janela.waitFor();
  ok(await janela.locator('svg.campo').count() === 0, 'eventos: fora dos remates não há mapa');
  await campo('equipa').nth(1).click();
  ok((await campo('jogador').inputValue()) === '', 'eventos: ao mudar de equipa o jogador volta a ficar por escolher');
  await campo('jogador').selectOption(String(delesJogador.id));
  await campo('tipo').selectOption('FALTA_OFENSIVA');
  await campo('guardar').click();
  await janela.waitFor({ state: 'hidden' });
  e = await evento(perda);
  ok(e.equipa_id === aguias.id && e.jogador_id === delesJogador.id && e.tipo_evento_codigo === 'FALTA_OFENSIVA' && e.parte === 2 && e.segundo_jogo === 1900, 'eventos: a perda de bola passou a falta ofensiva da outra equipa');

  // O que está mal não deixa guardar; Esc fecha sem mudar nada
  await linha(doisMin).locator('button[data-acao="corrigir"]').click();
  await janela.waitFor();
  await campo('minuto').fill('99:99');
  ok((await campo('guardar').isDisabled()) && (await texto(campo('erros'))).includes('minuto'), 'eventos: um minuto inválido avisa e não deixa guardar');
  await p.keyboard.press('Escape');
  await janela.waitFor({ state: 'hidden' });
  ok((await evento(doisMin)).segundo_jogo === 2100, 'eventos: Esc fecha a janela sem mudar nada');
  await linha(remateFora).locator('button[data-acao="corrigir"]').click();
  await janela.waitFor();
  await campo('jogador').selectOption('');
  ok((await texto(campo('erros'))).includes('jogador') && await campo('guardar').isDisabled(), 'eventos: num remate o jogador é obrigatório');
  await campo('cancelar').click();
  await janela.waitFor({ state: 'hidden' });

  // Apagar um evento
  await linha(doisMin).locator('button[data-acao="apagar"]').click();
  await p.waitForFunction((id) => !document.querySelector(`tr[data-evento-id="${id}"]`), doisMin);
  ok((await q('SELECT 1 FROM eventos WHERE id = $1', [doisMin])).length === 0 && (await ids()).length === 3, 'eventos: apagar tira o evento da lista e da base de dados');
  await captura(p, 'eventos-depois');
  await p.close();

  // Um jogo que não é da conta não se abre
  const intruso = await pagina('/eventos.html?jogo=99999', { tolerar: ['404'] });
  await intruso.waitForSelector('#erro-eventos');
  ok((await texto(intruso.locator('#erro-eventos'))).includes('Jogonãoencontrado'), 'eventos: um jogo que não existe diz «Jogo não encontrado»');
  await intruso.close();
});

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

  // Estatísticas: a equipa da segunda conta ainda não tem jogos, e a equipa da primeira não se lê
  const estB = await pagina('/estatisticas.html', { contexto: ctxB });
  await estB.waitForSelector('#estatisticas .cartao .vazio');
  ok(((await estB.locator('#estatisticas .cartao h2').textContent()) ?? '') === nomeEquipaB && ((await estB.locator('#estatisticas .vazio').textContent()) ?? '').startsWith('Ainda não há jogos registados.')
    && (await estB.locator('#tabela-estatisticas').count()) === 0, 'segunda conta: nas estatísticas, sem jogos, diz que ainda não há jogos (e não mostra os da primeira)');
  await estB.close();
  const [{ equipa_id: propriaDaPrimeira }] = await q('SELECT equipa_id FROM utilizadores WHERE id = $1', [donoId]);
  ok((await ctxB.request.get(`${servidor.url}/api/equipas/${propriaDaPrimeira}/estatisticas`)).status() === 404, 'segunda conta: as estatísticas da equipa da primeira conta dão 404');
  ok((await ctxB.request.get(`${servidor.url}/api/equipas/${propriaDaPrimeira}/adversario`)).status() === 404, 'segunda conta: o relatório do adversário de uma equipa da primeira conta dá 404');

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

// ======================= Administração =======================
// O primeiro admin vem da configuração da API (Administracao__Emails=admin-teste@exemplo.pt, ver tests/api.sh): a conta
// cria-se pela página como as outras e passa a admin quando entra.
await passo('Administração: contas, jogos, correção de eventos e registo de alterações', async () => {
  const emailAdmin = process.env.ADMIN_EMAIL ?? 'admin-teste@exemplo.pt';
  const emailB = `bruno-${sufixo}@exemplo.pt`;
  const nomeB = 'Bruno';
  const [bruno] = await q('SELECT id, equipa_id FROM utilizadores WHERE email = $1', [emailB]);
  if (!bruno) return ok(false, 'administração: falta a conta do passo anterior');

  // Um jogo da conta do Bruno, com dois eventos, para o admin corrigir
  const localAdmin = `Pavilhão Admin ${sufixo}`;
  const [adversaria] = await q('INSERT INTO equipas (nome, dono_id) VALUES ($1, $2) RETURNING id', [`Adversária Admin ${sufixo}`, bruno.id]);
  const [lateral1] = await q("INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo) VALUES ($1, 71, 'Rui Admin', 'LE') RETURNING id", [bruno.equipa_id]);
  const [lateral2] = await q("INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo) VALUES ($1, 72, 'Tiago Admin', 'LE') RETURNING id", [bruno.equipa_id]);
  const [guardaRedes] = await q("INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo) VALUES ($1, 1, 'Gil Admin', 'GR') RETURNING id", [adversaria.id]);
  const [lateralAdv] = await q("INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo) VALUES ($1, 5, 'Nuno Admin', 'LE') RETURNING id", [adversaria.id]);
  const [jogo] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id, local, data_hora) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [bruno.equipa_id, adversaria.id, bruno.id, localAdmin, '2026-10-20T18:00:00Z']);
  const novo = async (equipa, tipo, jogador, { resultado = null, parte = 1, segundo = 0, x = null, y = null, guardaRedesId = null } = {}) => (await q(
    `INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, guarda_redes_id, resultado, x, y, parte, segundo_jogo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [jogo.id, equipa, tipo, jogador, guardaRedesId, resultado, x, y, parte, segundo]))[0].id;
  const remateFora = await novo(bruno.equipa_id, 'REMATE', lateral1.id, { resultado: 'FORA', x: 50, y: 40, segundo: 120, guardaRedesId: guardaRedes.id });
  const doisMin = await novo(adversaria.id, 'DOIS_MINUTOS', lateralAdv.id, { parte: 2, segundo: 2100 });

  // Quem não é admin não vê a ligação, e a página diz que é só para quem administra
  const normal = await pagina('/');
  await normal.waitForSelector('#conta-menu .quem');
  ok((await normal.locator('#ligacao-admin').count()) === 0, 'administração: uma conta normal não tem a ligação «Administração» no menu');
  await normal.close();
  const recusada = await pagina('/admin.html', { tolerar: ['403'] });
  await recusada.waitForSelector('#sem-acesso');
  ok((await recusada.locator('#tabela-contas').count()) === 0 && (await recusada.locator('#abas a:visible').count()) === 0, 'administração: uma conta normal só vê «Voltar aos jogos», sem listas');
  ok((await recusada.evaluate(async () => (await fetch('/api/admin/utilizadores')).status)) === 403, 'administração: e a API recusa-lhe a lista de contas (403)');
  const semAcessoEventos = await pagina(`/eventos.html?jogo=2&admin=1`, { tolerar: ['403', '404'], rapida: true });
  await semAcessoEventos.waitForURL((u) => u.pathname === '/');
  ok(caminhoDe(semAcessoEventos) === '/', 'administração: o modo admin da página de eventos leva uma conta normal de volta aos jogos');
  await semAcessoEventos.close();
  await recusada.close();

  // O admin cria a conta pela página (o email está em Administracao__Emails) e entra
  const ctxAdmin = await novoContexto();
  let p = await pagina('/', { contexto: ctxAdmin, tolerar: ['401'], rapida: true });
  await p.waitForURL(/entrar\.html/);
  await registarPelaPagina(p, { nome: 'Admin Teste', equipa: `Admin FC ${sufixo}`, email: emailAdmin, senha: SENHA });
  await p.waitForSelector('#painel-confirmar:not([hidden])');
  const { v: linkAdmin } = await abrirLinkDoEmail(emailAdmin, { contexto: ctxAdmin });
  await linkAdmin.close();
  await p.click('#ja-confirmei');
  await p.fill('#entrar-senha', SENHA);
  await p.click('#botao-entrar');
  await p.waitForURL((u) => u.pathname === '/');
  await p.waitForSelector('#ligacao-admin');
  ok((await q('SELECT papel FROM utilizadores WHERE email = $1', [emailAdmin]))[0]?.papel === 'admin', 'administração: o email da configuração passou a admin ao entrar');
  ok((await texto(p.locator('#ligacao-admin'))) === 'Administração', 'administração: o menu da conta tem a ligação «Administração»');
  await p.close();

  // Utilizadores
  p = await pagina('/', { contexto: ctxAdmin });
  await Promise.all([p.waitForURL(/admin\.html/), p.click('#ligacao-admin')]);
  await p.waitForSelector('#tabela-contas');
  const [{ n }] = await q('SELECT COUNT(*)::int AS n FROM utilizadores');
  ok((await texto(p.locator('#n-total'))) === `${n}contas`, `administração: o topo conta as contas (${n})`);
  ok((await p.locator('#tabela-contas tbody tr').count()) === n, 'administração: a tabela tem uma linha por conta');
  const linhaB = p.locator(`#tabela-contas tr[data-email="${emailB}"]`);
  ok((await texto(linhaB)).includes(nomeB) && (await texto(linhaB.locator('[data-estado]'))) === 'Ativa' && (await texto(linhaB.locator('[data-papel]'))) === 'Normal', 'administração: a conta do Bruno aparece ativa e normal');
  const linhaAdmin = p.locator(`#tabela-contas tr[data-email="${emailAdmin}"]`);
  ok((await texto(linhaAdmin)).includes('Atuaconta') && (await linhaAdmin.locator('button').count()) === 0, 'administração: na própria conta não há botões (ninguém mexe na sua conta)');
  await captura(p, 'admin-utilizadores');
  await p.fill('input[data-pesquisa="utilizadores"]', 'bruno');
  ok((await p.locator('#tabela-contas tbody tr').count()) === 1, 'administração: procurar «bruno» deixa só a conta dele');
  await p.fill('input[data-pesquisa="utilizadores"]', '');
  await p.click('[data-filtro="admins"]');
  ok((await p.locator('#tabela-contas tbody tr').count()) === 1 && (await p.locator(`#tabela-contas tr[data-email="${emailAdmin}"]`).count()) === 1, 'administração: o filtro «Admins» mostra só o admin');
  await p.click('[data-filtro="todas"]');

  // Desativar: a conta deixa de entrar; ativar: volta a entrar
  await linhaB.locator('[data-acao="desativar"]').click();
  await linhaB.locator('[data-estado="desativado"]').waitFor();
  ok((await q('SELECT desativado_em FROM utilizadores WHERE id = $1', [bruno.id]))[0].desativado_em !== null, 'administração: desativar guarda a data na base de dados');
  ok((await linhaB.locator('[data-acao="repor"]').count()) === 0 && (await linhaB.locator('[data-acao="ativar"]').count()) === 1, 'administração: uma conta desativada só se pode voltar a ativar');
  ok((await texto(p.locator('#n-desativadas'))) === '1desativadas', 'administração: o topo conta as desativadas');
  const ctxB2 = await novoContexto();
  const entradaB = await pagina('/entrar.html', { contexto: ctxB2, tolerar: ['401', '403'] });
  await entradaB.fill('#entrar-email', emailB);
  await entradaB.fill('#entrar-senha', 'outra-palavra-1');
  await entradaB.click('#botao-entrar');
  await entradaB.waitForFunction(() => document.getElementById('erro-entrar')?.textContent.includes('desativada'));
  ok(entradaB.url().includes('entrar.html') && !(await ctxB2.cookies()).some((c) => c.name === 'sessao'), 'administração: a conta desativada não entra e a página diz porquê');
  await linhaB.locator('[data-acao="ativar"]').click();
  await linhaB.locator('[data-estado="ativo"]').waitFor();
  await entradaB.click('#botao-entrar');
  await entradaB.waitForURL((u) => u.pathname === '/');
  ok((await ctxB2.cookies()).some((c) => c.name === 'sessao'), 'administração: depois de ativada, a conta volta a entrar');
  await entradaB.close();
  await ctxB2.close();

  // Papel
  await linhaB.locator('[data-acao="admin"]').click();
  await linhaB.locator('[data-papel="admin"]').waitFor();
  ok((await q('SELECT papel FROM utilizadores WHERE id = $1', [bruno.id]))[0].papel === 'admin' && (await texto(p.locator('#n-admins'))) === '2admins', 'administração: «Tornar admin» muda o papel e o topo conta 2 admins');
  await linhaB.locator('[data-acao="normal"]').click();
  await linhaB.locator('[data-papel="normal"]').waitFor();
  ok((await q('SELECT papel FROM utilizadores WHERE id = $1', [bruno.id]))[0].papel === 'normal', 'administração: «Tirar admin» volta ao papel normal');

  // Repor a palavra-passe: chega à conta um email com a ligação (o admin não vê nem escolhe a palavra-passe)
  await linhaB.locator('[data-acao="repor"]').click();
  await p.waitForFunction(() => document.getElementById('aviso')?.textContent.includes('Enviámos a ligação'));
  const tokenRepor = await ultimoToken(emailB, 2, 'redefinir');
  ok(!!tokenRepor && (await mensagensPara(emailB)).length === 2, 'administração: «Repor palavra-passe» envia à conta o email com a ligação');
  ok(!(await p.content()).includes(tokenRepor), 'administração: e a página do admin não mostra o código da ligação');

  // Jogos de todas as contas, e corrigir os eventos de um
  await p.click('#abas a[data-aba="jogos"]');
  await p.waitForSelector('#tabela-jogos');
  await p.fill('input[data-pesquisa="jogos"]', localAdmin);
  const linhaJogo = p.locator(`#tabela-jogos tr[data-jogo-id="${jogo.id}"]`);
  ok((await p.locator('#tabela-jogos tbody tr').count()) === 1 && (await texto(linhaJogo.locator('td.dono'))) === nomeB && (await texto(linhaJogo)).includes('0–0'), 'administração: o jogo do Bruno aparece com a conta dona e o resultado');
  await p.fill('input[data-pesquisa="jogos"]', '');
  ok((await p.locator('#tabela-jogos tbody tr').count()) > 5, 'administração: a lista tem os jogos de todas as contas');
  await captura(p, 'admin-jogos');
  await p.fill('input[data-pesquisa="jogos"]', localAdmin);
  await Promise.all([p.waitForURL(new RegExp(`eventos\\.html\\?jogo=${jogo.id}&admin=1`)), linhaJogo.locator('a[data-acao="eventos"]').click()]);
  await p.waitForSelector('#tabela-eventos');
  ok((await texto(p.locator('#nota-admin'))).includes(nomeB), 'eventos (admin): a página avisa que se vê como admin o jogo da conta do Bruno');
  ok((await p.locator('a[href^="banco.html"]').count()) === 0 && (await p.locator('a[href*="exportar.xlsx"]').count()) === 0, 'eventos (admin): sem Banco nem Excel (são do dono)');
  ok((await texto(p.locator('.menu'))) === 'Administração' && (await p.locator('#voltar-admin').count()) === 1, 'eventos (admin): o menu só leva à administração');
  ok((await p.locator('#tabela-eventos tbody tr').count()) === 2, 'eventos (admin): vê os 2 eventos do jogo de outra conta');
  await captura(p, 'admin-eventos');

  // Corrigir o remate fora: é golo, aos 3:05
  await p.locator(`#tabela-eventos tr[data-evento-id="${remateFora}"] button[data-acao="corrigir"]`).click();
  const janela = p.locator('#janela-evento .janela-evento');
  await janela.waitFor();
  const campo = (nome) => janela.locator(`[data-campo="${nome}"]`);
  await janela.locator('button[data-resultado="GOLO"]').click();
  await janela.locator('.evento-baliza').waitFor({ state: 'visible' });
  await janela.locator('svg.baliza').click({ position: { x: 300, y: 40 } });
  await campo('jogador').selectOption(String(lateral2.id));
  await campo('minuto').fill('3:05');
  await campo('guardar').click();
  await janela.waitFor({ state: 'detached' });
  await p.waitForFunction(() => document.getElementById('resultado-eventos')?.textContent.replace(/\s/g, '') === '1–0');
  const [corrigido] = await q('SELECT resultado, jogador_id, segundo_jogo FROM eventos WHERE id = $1', [remateFora]);
  ok(corrigido.resultado === 'GOLO' && corrigido.jogador_id === lateral2.id && corrigido.segundo_jogo === 185, `eventos (admin): o remate de outra conta ficou golo de outro jogador aos 3:05 (${JSON.stringify(corrigido)})`);

  // Apagar os 2 minutos
  await p.locator(`#tabela-eventos tr[data-evento-id="${doisMin}"] button[data-acao="apagar"]`).click();
  await p.waitForFunction(() => document.querySelectorAll('#tabela-eventos tbody tr').length === 1);
  ok((await q('SELECT 1 FROM eventos WHERE id = $1', [doisMin])).length === 0, 'eventos (admin): apagar tira o evento da base de dados');

  // O registo de alterações diz quem fez o quê
  await Promise.all([p.waitForURL(/admin\.html#jogos/), p.click('#voltar-admin')]);
  await p.click('#abas a[data-aba="registo"]');
  await p.waitForSelector('#registo');
  const registo = await q('SELECT autor_nome, tipo, acao, detalhe, jogo_id FROM registo_alteracoes ORDER BY id');
  const tem = (acao, parte = '') => registo.some((l) => l.acao === acao && l.detalhe.includes(parte));
  ok(tem('Conta desativada', emailB) && tem('Conta ativada', emailB) && tem('Papel alterado', `${emailB}: Normal passou a Admin`) && tem('Papel alterado', `${emailB}: Admin passou a Normal`)
    && tem('Ligação para repor a palavra-passe enviada', emailB) && tem('Papel alterado', `${emailAdmin}: Normal passou a Admin (configuração)`), 'registo: contas desativadas e ativadas, papéis e ligações, na base de dados');
  ok(tem('Evento corrigido', 'resultado de Fora para Golo') && tem('Evento apagado', '2 minutos') && registo.filter((l) => l.tipo === 'evento').every((l) => l.jogo_id === jogo.id && l.autor_nome === 'Admin Teste'),
    'registo: o evento corrigido e o apagado, com o jogo e o autor');
  const texto2 = (await p.locator('#registo').textContent()).replace(/\s+/g, ' ');
  ok(['Conta desativada', 'Conta ativada', 'Papel alterado', 'Evento corrigido', 'Evento apagado', 'Ligação para repor a palavra-passe enviada', 'por Admin Teste', 'por Sistema', emailB]
    .every((t) => texto2.includes(t)), 'registo: a página mostra as ações, quem as fez e o detalhe');
  await captura(p, 'admin-registo');
  await p.click('[data-filtro="evento"]');
  await p.waitForFunction(() => document.querySelectorAll('#registo [data-registo-id]').length === 2);
  ok((await p.locator('#registo [data-tipo="conta"]').count()) === 0, 'registo: o filtro «Eventos» mostra só as 2 linhas dos eventos');
  await p.click('[data-filtro="conta"]');
  await p.waitForFunction(() => document.querySelectorAll('#registo [data-registo-id]').length > 2 && !document.querySelector('#registo [data-tipo="evento"]'));
  await p.fill('input[data-pesquisa="registo"]', 'sistema');
  ok((await p.locator('#registo [data-registo-id]').count()) === 1, 'registo: procurar «sistema» deixa só a promoção feita pela configuração');
  ok((await p.locator('a.registo-ligacao').count()) === 0, 'registo: as linhas de contas não têm ligação para jogos');
  await p.click('[data-filtro="tudo"]');
  await p.fill('input[data-pesquisa="registo"]', '');
  await p.locator('a.registo-ligacao').first().waitFor();
  ok((await p.locator('a.registo-ligacao').first().getAttribute('href')) === `eventos.html?jogo=${jogo.id}&admin=1`, 'registo: as linhas dos eventos abrem o jogo no modo de administração');

  await p.close();
  await ctxAdmin.close();
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
