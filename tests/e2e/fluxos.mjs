// Testes de ponta a ponta: abre as páginas num Chromium a sério e usa-as como um utilizador,
// contra a API verdadeira e a base de dados PostgreSQL (com os dados de exemplo).
//
//   API_URL=http://localhost:5080 PGHOST=localhost PGUSER=scouting PGPASSWORD=scouting PGDATABASE=scouting \
//     node e2e/fluxos.mjs
//
// O script arranca um pequeno servidor (e2e/servidor.mjs) que serve o frontend e reencaminha /api e /hub
// para a API, como o nginx da imagem Docker. Assume uma base "virgem" (só os dados de db/init).
//
// Variáveis: API_URL (http://localhost:5080), E2E_DIR (./resultados, onde ficam capturas e Excel),
//            APP_URL (usar um servidor já a correr em vez de arrancar o próprio),
//            SIGNALR_FALSO (só para desenvolver estes testes sem a API: ficheiro JS que substitui a biblioteca SignalR).
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
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'pt-PT', timezoneId: 'UTC', acceptDownloads: true });
if (SIGNALR_FALSO) await ctx.route('**/lib/signalr.min.js', (r) => r.fulfill({ contentType: 'text/javascript', body: SIGNALR_FALSO }));

const falhas = [];
const linhas = [];
function ok(condicao, mensagem) {
  const linha = `${condicao ? 'OK   ' : 'FALHA'} ${mensagem}`;
  linhas.push(linha);
  console.log(linha);
  if (!condicao) falhas.push(mensagem);
}
const errosPaginas = [];
async function pagina(caminho) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errosPaginas.push(`${caminho}: ${e.message}`));
  // os 409 são esperados nos testes de nomes e números repetidos
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('409')) errosPaginas.push(`${caminho}: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  await page.goto(servidor.url + caminho, { waitUntil: 'networkidle' });
  return page;
}
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
async function empurrar(page, jogoId) {
  if (!SIGNALR_FALSO) return;
  await page.evaluate(async (id) => {
    window.__hub.EstatisticasAtualizadas(await (await fetch(`/api/jogos/${id}/estatisticas`)).json());
  }, jogoId);
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
  ok((await p.locator('.jogo-cartao').count()) >= 2, 'jogos: lista os jogos');
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
  const [eq] = await q('INSERT INTO equipas (nome) VALUES ($1) RETURNING id', [`Gigantes ${sufixo}`]);
  for (let n = 1; n <= 17; n++) {
    await q('INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo) VALUES ($1,$2,$3,$4)', [eq.id, n, `Jogador ${n}`, n === 1 ? 'GR' : 'LE']);
  }
  const [jogo] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id) VALUES ($1,$2) RETURNING id', [eq.id, aguias.id]);

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

  const [{ id: semLista }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id) VALUES ($1,$2) RETURNING id', [aguias.id, leoes.id]);
  const p2 = await pagina(`/banco.html?jogo=${semLista}`);
  await p2.waitForSelector('.botao-jogador');
  ok((await p2.locator('.botao-jogador').count()) === 6, 'banco: sem convocatória mostra todos os jogadores de campo (6)');
  ok(await p2.locator('#nota-convocatoria').isVisible(), 'banco: nota a sugerir a convocatória');
  ok((await p2.locator('#nota-convocatoria a').getAttribute('href')) === `convocatoria.html?jogo=${semLista}`, 'banco: ligação para a convocatória');
  await p2.close();
});

// ======================= Tempo real: banco -> API -> dashboard =======================
await passo('Banco regista, dashboard recebe em tempo real', async () => {
  const [{ id: jogoId }] = await q('INSERT INTO jogos (equipa_casa_id, equipa_fora_id) VALUES ($1,$2) RETURNING id', [aguias.id, leoes.id]);
  const dash = await pagina(`/dashboard.html?jogo=${jogoId}`);
  ok(await esperarPor(async () => (await dash.locator('#ligacao').getAttribute('class'))?.includes('ok')), 'dashboard: ligado ao hub (em direto)');
  ok((await dash.locator('#ligacao').textContent()) === 'em direto', 'dashboard: estado "em direto"');
  ok((await texto(dash.locator('#golos-casa'))) === '0' && (await texto(dash.locator('#golos-fora'))) === '0', 'dashboard: começa em 0–0');

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
  ok(await esperarPor(async () => (await dash.locator('.camada-marcadores .marcador').count()) === 1), 'dashboard: o remate aparece no mapa');
  await captura(dash, 'dashboard-tempo-real');

  // um segundo remate: defesa do guarda-redes
  await banco.locator('#campo').click({ position: { x: caixa.width * 0.25, y: caixa.height * 0.55 } });
  await banco.locator('.botao-jogador').nth(1).click();
  await banco.click('.botao-resultado[data-resultado="DEFESA"]');
  ok(await esperarPor(async () => (await q('SELECT 1 FROM eventos WHERE jogo_id = $1', [jogoId])).length === 2), 'banco: a defesa ficou na base de dados');
  await empurrar(banco, jogoId);
  await empurrar(dash, jogoId);
  ok(await esperarPor(async () => (await dash.locator('.camada-marcadores .marcador').count()) === 2), 'dashboard: 2 remates no mapa');
  ok((await texto(dash.locator('#golos-casa'))) === '1', 'dashboard: a defesa não altera o placar');

  // desfazer o último
  await banco.click('#btn-desfazer');
  ok(await esperarPor(async () => (await q('SELECT 1 FROM eventos WHERE jogo_id = $1', [jogoId])).length === 1), 'banco: "Desfazer último" apaga a defesa');
  await empurrar(banco, jogoId);
  await empurrar(dash, jogoId);
  ok(await esperarPor(async () => (await dash.locator('.camada-marcadores .marcador').count()) === 1), 'dashboard: volta a 1 remate no mapa');

  // apagar o golo -> placar 0–0
  await banco.click('#btn-desfazer');
  ok(await esperarPor(async () => (await q('SELECT 1 FROM eventos WHERE jogo_id = $1', [jogoId])).length === 0), 'banco: o golo foi apagado');
  await empurrar(dash, jogoId);
  ok(await esperarPor(async () => (await texto(dash.locator('#golos-casa'))) === '0'), 'dashboard: o placar volta a 0');
  await banco.close();
  await dash.close();
});

// ======================= Dashboard: Excel =======================
await passo('Dashboard: exportar para Excel', async () => {
  const p = await pagina('/dashboard.html?jogo=2');
  await p.waitForSelector('.exportar a');
  ok((await p.locator('#excel-jogo').getAttribute('href')) === '/api/jogos/2/exportar.xlsx', 'dashboard: botão Excel do topo');
  const hrefs = await p.locator('.exportar a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  ok(hrefs[0].startsWith('/api/jogos/2/exportar.xlsx?equipaId=') && hrefs[1] === '/api/jogos/2/exportar.xlsx', `dashboard: botões Excel da equipa e do jogo (${hrefs})`);
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

  ok((await p.locator('.camada-marcadores .marcador').count()) > 0, 'dashboard: o mapa desenha os remates (SVG real)');
  const caixa = await p.locator('svg.campo').boundingBox();
  ok(caixa && caixa.width > 200 && caixa.height > 200, 'dashboard: o mapa tem tamanho visível');
  await captura(p, 'dashboard');
  await p.close();
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
