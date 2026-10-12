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
//            SIGNALR_FALSO (só para desenvolver estes testes sem a API: ficheiro JS que substitui a biblioteca SignalR).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import pg from 'pg';
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
// da rede: para páginas que redirecionam sozinhas).
async function pagina(caminho, { contexto = ctx, tolerar = [], rapida = false } = {}) {
  const page = await contexto.newPage();
  const esperados = ['409', ...tolerar];
  page.on('pageerror', (e) => errosPaginas.push(`${caminho}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !esperados.some((e) => m.text().includes(e))) errosPaginas.push(`${caminho}: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  await page.goto(servidor.url + caminho, { waitUntil: rapida ? 'domcontentloaded' : 'networkidle' });
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
const nomeDragoes = `Dragões ${sufixo}`;
const [aguias] = await q("SELECT id FROM equipas WHERE nome = 'Águias do Norte'");
const [leoes] = await q("SELECT id FROM equipas WHERE nome = 'Leões do Sul'");

// ======================= Contas =======================
const emailPrincipal = `principal-${sufixo}@exemplo.pt`;
const nomePrincipal = `Principal ${sufixo}`;
const SENHA = 'palavra-passe-123';
let donoId; // id da conta principal (dona dos dados de exemplo)

async function registarPelaPagina(p, { nome, email, senha }) {
  await p.click('#aba-registo');
  await p.fill('#registo-nome', nome);
  await p.fill('#registo-email', email);
  await p.fill('#registo-senha', senha);
  await p.click('#botao-registo');
}

await passo('Contas: criar conta, sair e entrar', async () => {
  // Sem sessão, as páginas levam à entrada e guardam para onde voltar
  let p = await pagina('/equipas.html', { tolerar: ['401'], rapida: true });
  await p.waitForURL(/entrar\.html/);
  ok(new URL(p.url()).searchParams.get('voltar') === 'equipas.html', `sem sessão: /equipas.html leva à entrada e guarda para onde voltar (${caminhoDe(p)})`);
  ok((await p.locator('#form-entrar').isVisible()) && (await p.locator('#form-registo').isHidden()), 'entrar: começa no formulário de entrada');
  await captura(p, 'entrar');

  await p.click('#aba-registo');
  ok((await p.locator('#form-registo').isVisible()) && (await p.getAttribute('#aba-registo', 'aria-selected')) === 'true', 'entrar: o separador "Criar conta" mostra o registo');
  await captura(p, 'registo');

  // Validações antes de enviar
  await p.fill('#registo-nome', nomePrincipal); await p.fill('#registo-email', 'sem-arroba'); await p.fill('#registo-senha', SENHA);
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

  // Criar a conta leva à página pedida (equipas.html), já com a sessão iniciada
  await p.click('#botao-registo');
  await p.waitForURL((u) => u.pathname === '/equipas.html');
  await p.waitForSelector('.item-equipa');
  ok(true, 'registo: criar a conta leva de volta à página pedida');
  ok((await p.locator('#conta-menu .quem').textContent()).includes(nomePrincipal), 'menu: mostra o nome da conta');
  ok((await p.locator('#conta-menu .avatar').textContent()) === 'P', 'menu: avatar com a inicial do nome');

  // O que ficou na base de dados: hash PBKDF2, só o hash da sessão, dados de exemplo herdados
  const [u] = await q('SELECT id, email, nome, palavra_passe_hash FROM utilizadores WHERE email = $1', [emailPrincipal]);
  donoId = u?.id;
  ok(u && u.nome === nomePrincipal && /^pbkdf2-sha256\$600000\$/.test(u.palavra_passe_hash) && !u.palavra_passe_hash.includes(SENHA), 'base de dados: palavra-passe guardada só como hash PBKDF2');
  const galleta = (await ctx.cookies()).find((c) => c.name === 'sessao');
  ok(galleta?.httpOnly === true && galleta.sameSite === 'Lax' && /^[0-9a-f]{64}$/.test(galleta.value), 'cookie de sessão: HttpOnly, SameSite=Lax, 64 hexadecimais');
  const hashDaSessao = galleta ? crypto.createHash('sha256').update(galleta.value).digest('hex') : '';
  const sessoes = await q('SELECT token_hash FROM sessoes WHERE utilizador_id = $1', [donoId]);
  ok(sessoes.length === 1 && sessoes[0].token_hash === hashDaSessao, 'base de dados: da sessão só fica o SHA-256 do código do cookie');
  ok((await q('SELECT 1 FROM equipas WHERE dono_id = $1 AND id IN ($2, $3)', [donoId, aguias.id, leoes.id])).length === 2, 'a primeira conta herdou as equipas de exemplo');
  ok((await q('SELECT 1 FROM jogos WHERE dono_id = $1 AND id = 2', [donoId])).length === 1, 'a primeira conta herdou os jogos de exemplo');

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
  ok(await p.locator('#botao-entrar').isEnabled(), 'entrar: o botão volta a ficar ativo depois do erro');
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
});

// ======================= Equipas e jogadores =======================
await passo('Equipas e jogadores', async () => {
  const p = await pagina('/equipas.html');
  ok((await p.locator('.item-equipa').count()) >= 2, 'equipas: lista as equipas existentes');
  await captura(p, 'equipas');

  await p.fill('#nome-equipa', nomeDragoes);
  await p.click('#form-equipa button[type=submit]');
  await p.waitForSelector(`.item-equipa[aria-current="true"]:has-text("${nomeDragoes}")`);
  ok(true, 'equipas: cria equipa e seleciona-a');
  ok((await p.locator('#form-equipa .erro-formulario').textContent()) === '', 'equipas: sem erro depois de criar');
  ok((await p.locator('#plantel .vazio').count()) === 1, 'equipas: o plantel novo está vazio');

  await p.fill('#nome-equipa', nomeDragoes);
  await p.click('#form-equipa button[type=submit]');
  await p.waitForFunction(() => document.getElementById('erro-equipa').textContent.includes('Já existe'));
  ok(true, 'equipas: nome repetido mostra o erro da API');

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
  ok((await p.locator('.item-equipa[aria-current="true"] small').textContent()).includes('3'), 'equipas: contador de jogadores atualizado (3)');
  ok((await q('SELECT count(*)::int AS n FROM jogadores WHERE equipa_id = (SELECT id FROM equipas WHERE nome = $1)', [nomeDragoes]))[0].n === 3, 'jogadores: gravados na base de dados');

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

  await p.locator('.item-equipa', { hasText: 'Águias do Norte' }).click();
  await p.waitForSelector('tbody tr:has-text("Rui Mesquita")');
  ok((await p.locator('tbody tr .botao.perigo:disabled').count()) === 8, 'jogadores: com eventos, o botão apagar está desativado');
  ok((await p.evaluate(() => location.search)) === `?equipa=${aguias.id}`, 'equipas: o URL guarda a equipa escolhida');
  await p.close();
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
  await p.selectOption('#casa', { label: nomeDragoes });
  await p.selectOption('#fora', { label: nomeDragoes });
  await p.click('#criar-jogo');
  ok((await p.locator('#erro-jogo').textContent()).includes('diferentes'), 'jogos: a mesma equipa nos dois lados é recusada');
  await p.selectOption('#fora', { label: 'Águias do Norte' });
  await p.fill('#local', 'Pavilhão Central');
  await p.fill('#data-hora', '2026-11-20T18:30');
  await Promise.all([p.waitForURL(/convocatoria\.html\?jogo=\d+/), p.click('#criar-jogo')]);
  novoJogoId = Number(new URL(p.url()).searchParams.get('jogo'));
  const [jogo] = await q('SELECT * FROM jogos WHERE id = $1', [novoJogoId]);
  ok(jogo?.local === 'Pavilhão Central', 'jogos: novo jogo criado com o local');
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
  ok(await v.locator('#voltar').isHidden(), 'visitante: sem seta para a lista de jogos (não tem conta)');
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
    ok((await n.locator('.sem-acesso a').getAttribute('href')).startsWith('entrar.html?voltar='), `visitante ${nome}: ligação para entrar na conta`);
    if (nome === 'sem código') await captura(n, 'dashboard-sem-acesso');
    await n.close();
  }
});

// ======================= Segunda conta =======================
await passo('Segunda conta: começa vazia e não vê os dados da primeira', async () => {
  const ctxB = await novoContexto();
  const emailB = `bruno-${sufixo}@exemplo.pt`;
  const nomeEquipaB = `Segunda do Bruno ${sufixo}`;

  let p = await pagina('/', { contexto: ctxB, tolerar: ['401'], rapida: true });
  await p.waitForURL(/entrar\.html/);
  await registarPelaPagina(p, { nome: 'Bruno', email: emailB, senha: 'outra-palavra-1' });
  await p.waitForURL((u) => u.pathname === '/');
  await p.waitForSelector('.estado-vazio');
  const [b] = await q('SELECT id FROM utilizadores WHERE email = $1', [emailB]);
  ok(b?.id && b.id !== donoId, 'segunda conta: criada (conta diferente da primeira)');
  ok((await q('SELECT 1 FROM equipas WHERE dono_id = $1', [b.id])).length === 0 && (await q('SELECT 1 FROM jogos WHERE dono_id = $1', [b.id])).length === 0, 'segunda conta: não herda os dados de exemplo (só a primeira conta herda)');
  ok(await p.locator('#novo-jogo').isHidden(), 'segunda conta: sem equipas não há "Novo jogo"');
  ok((await p.locator('.estado-vazio .passos li').count()) === 3 && (await p.locator('.estado-vazio a[href="equipas.html"]').count()) === 1, 'segunda conta: lista vazia mostra os 3 primeiros passos e leva às equipas');
  ok((await p.locator('.jogo-linha').count()) === 0, 'segunda conta: não vê os jogos da primeira');
  await captura(p, 'conta-nova-vazia');

  // Equipas: a mesma designação que a primeira conta tem pode existir aqui
  await Promise.all([p.waitForURL(/equipas\.html/), p.click('.estado-vazio a[href="equipas.html"]')]);
  await p.waitForSelector('#form-equipa');
  ok((await p.locator('.item-equipa').count()) === 0, 'segunda conta: não vê as equipas da primeira');
  for (const nome of ['Águias do Norte', nomeEquipaB]) {
    await p.fill('#nome-equipa', nome);
    await p.click('#form-equipa button[type=submit]');
    await p.waitForSelector(`.item-equipa[aria-current="true"]:has-text("${nome}")`);
  }
  ok((await p.locator('.item-equipa').count()) === 2, 'segunda conta: duas equipas criadas (uma com o mesmo nome de uma equipa da primeira conta)');
  ok((await q('SELECT 1 FROM equipas WHERE dono_id = $1', [b.id])).length === 2 && (await q("SELECT 1 FROM equipas WHERE nome = 'Águias do Norte'")).length === 2, 'base de dados: duas equipas "Águias do Norte", cada uma do seu dono');
  await p.fill('#nome-equipa', nomeEquipaB);
  await p.click('#form-equipa button[type=submit]');
  await p.waitForFunction(() => document.getElementById('erro-equipa').textContent.includes('Já existe'));
  ok(true, 'segunda conta: o nome repetido na mesma conta continua recusado');

  // Criar o seu primeiro jogo
  await p.close();
  p = await pagina('/', { contexto: ctxB });
  ok(await p.locator('#novo-jogo').isVisible(), 'segunda conta: com duas equipas aparece "Novo jogo"');
  await p.click('.estado-vazio button');
  ok(await p.locator('#novo-jogo').evaluate((d) => d.open), 'segunda conta: "Criar o primeiro jogo" abre o formulário');
  await p.selectOption('#casa', { label: nomeEquipaB });
  await p.selectOption('#fora', { label: 'Águias do Norte' });
  await Promise.all([p.waitForURL(/convocatoria\.html\?jogo=\d+/), p.click('#criar-jogo')]);
  const jogoB = Number(new URL(p.url()).searchParams.get('jogo'));
  ok((await q('SELECT dono_id FROM jogos WHERE id = $1', [jogoB]))[0]?.dono_id === b.id, 'segunda conta: o jogo novo fica na segunda conta');
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

  // E a primeira conta não vê nada da segunda
  const alheio = await pagina(`/convocatoria.html?jogo=${jogoB}`, { tolerar: ['404'] });
  ok(await esperarPor(async () => ((await alheio.locator('#conteudo .vazio').first().textContent().catch(() => '')) ?? '').includes('Jogo não encontrado')), 'primeira conta: o jogo da segunda conta "não existe"');
  await alheio.close();
  const equipas = await pagina('/equipas.html');
  ok((await equipas.locator('.item-equipa', { hasText: nomeEquipaB }).count()) === 0, 'primeira conta: não vê as equipas da segunda');
  await equipas.close();

  // Sair da segunda conta não termina a sessão da primeira
  const sair = await pagina('/', { contexto: ctxB });
  await Promise.all([sair.waitForURL(/entrar\.html/), sair.click('#conta-menu button')]);
  ok(!(await ctxB.cookies()).some((c) => c.name === 'sessao') && (await q('SELECT 1 FROM sessoes WHERE utilizador_id = $1', [donoId])).length >= 1, 'segunda conta: sair só termina a sua sessão');
  await sair.close();
  await ctxB.close();
});

// ======================= Resultado =======================
ok(errosPaginas.length === 0, `sem erros de JavaScript nem da consola${errosPaginas.length ? `: ${errosPaginas.join(' | ')}` : ''}`);
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
