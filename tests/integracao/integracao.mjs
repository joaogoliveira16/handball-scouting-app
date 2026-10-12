// Teste de integração da API verdadeira (contas, HTTP, SignalR e Excel) contra uma base PostgreSQL com os dados de exemplo.
//
//   API_URL=http://localhost:5080 EXCEL_DIR=./resultados node integracao/integracao.mjs
//
// Precisa da API a correr e de uma base de dados ACABADA DE CRIAR com db/init/*.sql: a primeira conta que o teste
// regista e confirma herda os dados de exemplo (equipas e jogos sem dono). A API tem de enviar os emails para uma caixa
// de correio de teste (Mailpit: SMTP 1025, API http em EMAIL_API=http://localhost:8025). Sai com código 1 se alguma verificação falhar.
import fs from 'node:fs';
import path from 'node:path';
import * as signalR from '@microsoft/signalr';
import { esperarMensagens, lerMensagem, mensagensPara, tokenDe, ultimoToken } from '../correio.mjs';

const API = process.env.API_URL ?? 'http://localhost:5080';
const EXCEL_DIR = process.env.EXCEL_DIR ?? path.join(process.cwd(), 'resultados');
fs.mkdirSync(EXCEL_DIR, { recursive: true });

const falhas = [];
const linhas = [];
function ok(condicao, mensagem, detalhe = '') {
  const linha = `${condicao ? 'OK   ' : 'FALHA'} ${mensagem}${!condicao && detalhe ? `  -> ${detalhe}` : ''}`;
  linhas.push(linha);
  console.log(linha);
  if (!condicao) falhas.push(`${mensagem}${detalhe ? ` (${detalhe})` : ''}`);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(condicao, ms = 8000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (condicao()) return true;
    await esperar(50);
  }
  return condicao();
}

// Cada "sessão" é um cliente com o seu cookie (como um browser). A anónima nunca tem cookie.
class Sessao {
  constructor(nome) { this.nome = nome; this.cookie = null; }
}
const principal = new Sessao('principal');   // a 1.ª conta: fica com os dados de exemplo
const segunda = new Sessao('segunda');       // a 2.ª conta: começa vazia
const anonima = new Sessao('anónima');       // quem só tem o link

function guardarCookie(sessao, resposta) {
  for (const linha of resposta.headers.getSetCookie?.() ?? []) {
    const par = linha.split(';')[0];
    const nome = par.slice(0, par.indexOf('='));
    const valor = par.slice(par.indexOf('=') + 1);
    if (nome === 'sessao') sessao.cookie = valor === '' ? null : `sessao=${valor}`;
  }
}

async function http(metodo, caminho, corpo, sessao = principal) {
  const cabecalhos = {};
  if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
  if (sessao.cookie) cabecalhos.Cookie = sessao.cookie;
  const resposta = await fetch(API + caminho, {
    method: metodo,
    headers: cabecalhos,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  guardarCookie(sessao, resposta);
  const texto = await resposta.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* resposta sem JSON */ }
  return { status: resposta.status, json, texto, cabecalhos: resposta.headers, setCookie: resposta.headers.getSetCookie?.() ?? [] };
}

/** Pedido sem interpretar a resposta (ficheiros). */
function bruto(caminho, sessao = principal) {
  return fetch(API + caminho, { headers: sessao.cookie ? { Cookie: sessao.cookie } : {} });
}

/** Ligação ao hub com o cookie da sessão (o browser envia-o sozinho; aqui põe-se à mão). */
function ligarHub(sessao, nivel = signalR.LogLevel.Error) {
  return new signalR.HubConnectionBuilder()
    .withUrl(`${API}/hub/jogo`, { headers: sessao.cookie ? { Cookie: sessao.cookie } : {} })
    .configureLogging(nivel)
    .build();
}

/** O hub recusa o jogo? (jogo que não existe, de outra conta ou sem o código certo) */
async function hubRecusa(ligacao, jogoId, codigo) {
  try {
    await ligacao.invoke('EntrarNoJogo', jogoId, codigo ?? null);
    return false;
  } catch (erro) {
    return /Jogo não encontrado/.test(String(erro?.message ?? erro));
  }
}
const descricao = (r) => `HTTP ${r.status} ${r.texto.slice(0, 200)}`;

async function passo(nome, funcao) {
  console.log(`\n== ${nome}`);
  try {
    await funcao();
  } catch (erro) {
    ok(false, `${nome}: exceção inesperada`, String(erro?.stack ?? erro).split('\n').slice(0, 3).join(' | '));
  }
}

const sufixo = Date.now().toString(36);
let jogoNovo = null;   // { id, casaId, foraId, jogadores... } criado nos passos de cadastro

const emailPrincipal = `principal-${sufixo}@exemplo.pt`;
const emailSegunda = `segunda-${sufixo}@exemplo.pt`;
const SENHA = 'palavra-passe-123';
const URL_PUBLICO = process.env.URL_PUBLICO ?? 'http://localhost:8080';   // App__UrlPublico da API: vai nos links dos emails

// ----------------------------------------------------------------------
await passo('Contas: sem sessão, registo, entrada, saída', async () => {
  // Sem sessão: tudo o que é da conta pede entrada (401); um jogo alheio "não existe" (404)
  const protegidas = [
    ['GET', '/api/conta'], ['GET', '/api/jogos'], ['GET', '/api/equipas'], ['POST', '/api/equipas'],
    ['GET', '/api/equipas/1/jogadores'], ['POST', '/api/equipas/1/jogadores'], ['PUT', '/api/jogadores/4'], ['DELETE', '/api/jogadores/4'],
    ['POST', '/api/jogos'], ['GET', '/api/jogos/2/convocados'], ['PUT', '/api/jogos/2/convocados'],
    ['POST', '/api/jogos/2/eventos'], ['DELETE', '/api/jogos/2/eventos/1'],
  ];
  for (const [metodo, caminho] of protegidas) {
    const r = await http(metodo, caminho, ['POST', 'PUT'].includes(metodo) ? {} : undefined, anonima);
    ok(r.status === 401, `sem sessão: ${metodo} ${caminho} = 401`, descricao(r));
  }
  ok((await http('GET', '/api/saude', undefined, anonima)).status === 200, 'sem sessão: /api/saude continua aberto');
  for (const caminho of ['/api/jogos/2', '/api/jogos/2/estatisticas', '/api/jogos/2/estatisticas/eficacia', '/api/jogos/2/exportar.xlsx']) {
    const r = await http('GET', caminho, undefined, anonima);
    ok(r.status === 404, `sem sessão nem código: GET ${caminho} = 404 (o jogo "não existe")`, descricao(r));
  }

  // Registo com dados inválidos
  const invalidos = [
    ['sem campos', {}],
    ['nome vazio', { nome: '  ', email: emailPrincipal, palavraPasse: SENHA }],
    ['nome gigante', { nome: 'x'.repeat(81), email: emailPrincipal, palavraPasse: SENHA }],
    ['email sem @', { nome: 'Ana', email: 'sem-arroba', palavraPasse: SENHA }],
    ['email sem domínio', { nome: 'Ana', email: 'ana@', palavraPasse: SENHA }],
    ['palavra-passe curta', { nome: 'Ana', email: emailPrincipal, palavraPasse: 'curta' }],
    ['palavra-passe só com espaços', { nome: 'Ana', email: emailPrincipal, palavraPasse: ' '.repeat(10) }],
    ['palavra-passe gigante', { nome: 'Ana', email: emailPrincipal, palavraPasse: 'x'.repeat(129) }],
  ];
  for (const [nome, corpo] of invalidos) {
    const r = await http('POST', '/api/conta/registar', corpo, new Sessao('inválida'));
    ok(r.status === 400 && typeof r.json?.erro === 'string' && r.setCookie.length === 0, `registo recusado (400, sem cookie): ${nome}`, descricao(r));
  }

  // Registo da conta principal (email com maiúsculas: fica guardado em minúsculas). Não inicia sessão: falta confirmar o email.
  const registo = await http('POST', '/api/conta/registar', { nome: `  Principal ${sufixo} `, email: emailPrincipal.toUpperCase(), palavraPasse: SENHA }, principal);
  ok(registo.status === 201 && registo.json?.email === emailPrincipal && registo.json.emailEnviado === true,
    'registo da conta principal = 201 (email em minúsculas e email de confirmação enviado)', descricao(registo));
  ok(JSON.stringify(Object.keys(registo.json ?? {}).sort()) === '["email","emailEnviado"]', 'a resposta do registo não traz a palavra-passe nem o código da sessão', registo.texto);
  ok(registo.setCookie.length === 0 && principal.cookie === null, 'registar não inicia sessão (só depois de confirmar o email)', registo.setCookie.join(' '));
  ok(/no-store/.test(registo.cabecalhos.get('cache-control') ?? ''), 'a resposta do registo não vai para a cache');

  // O email de confirmação chega à caixa de correio de teste, com o link para a página de confirmação
  const primeiro = (await esperarMensagens(emailPrincipal, 1))[0];
  const mensagem1 = primeiro ? await lerMensagem(primeiro.ID) : null;
  const token1 = tokenDe(mensagem1?.Text);
  ok(!!primeiro && /confirma/i.test(mensagem1.Subject) && mensagem1.From?.Address === 'scouting@exemplo.pt',
    'o email de confirmação chegou (assunto "Confirma...", do remetente configurado)', JSON.stringify(mensagem1?.Subject));
  ok(!!token1 && mensagem1.Text.includes(`${URL_PUBLICO}/verificar.html?t=${token1}`) && mensagem1.Text.includes(`Olá Principal ${sufixo},`),
    'o email tem o nome (sem espaços) e o link para a página de confirmação no endereço público', mensagem1?.Text?.slice(0, 160));
  ok(!!token1 && mensagem1.HTML.includes(`verificar.html?t=${token1}`), 'a versão HTML do email tem o mesmo link');
  ok(/^[0-9a-f]{64}$/.test(token1 ?? ''), 'o código do link tem 32 bytes aleatórios (64 hexadecimais)');

  // Antes de confirmar não se entra: 403 com código (a página oferece "reenviar"), sem cookie
  const antes = await http('POST', '/api/conta/entrar', { email: emailPrincipal, palavraPasse: SENHA }, principal);
  ok(antes.status === 403 && antes.json?.codigo === 'email_por_confirmar' && antes.setCookie.length === 0 && principal.cookie === null,
    'entrar sem ter confirmado o email = 403 com o código email_por_confirmar (e sem cookie)', descricao(antes));
  const antesErrada = await http('POST', '/api/conta/entrar', { email: emailPrincipal, palavraPasse: 'errada-errada' }, new Sessao('antes'));
  ok(antesErrada.status === 401 && antesErrada.json?.codigo === undefined, 'com a palavra-passe errada continua a ser 401 igual aos outros (não revela que a conta existe)', descricao(antesErrada));
  ok((await http('GET', '/api/jogos', undefined, principal)).status === 401, 'e sem sessão não vê nada');

  // Registar outra vez o mesmo email, ainda por confirmar, diz para pedir outro email
  const repetidoPorConfirmar = await http('POST', '/api/conta/registar', { nome: 'Outra', email: emailPrincipal, palavraPasse: 'outra-palavra-1' }, new Sessao('repetida'));
  ok(repetidoPorConfirmar.status === 409 && repetidoPorConfirmar.json?.codigo === 'email_por_confirmar' && repetidoPorConfirmar.setCookie.length === 0,
    'registar o mesmo email antes de o confirmar = 409 com o código email_por_confirmar', descricao(repetidoPorConfirmar));
  ok((await mensagensPara(emailPrincipal)).length === 1, 'e esse registo não enviou outro email');

  // Códigos inválidos
  for (const [nome, corpo] of [['sem código', {}], ['código curto', { token: 'abc' }], ['maiúsculas', { token: 'A'.repeat(64) }], ['desconhecido', { token: 'f'.repeat(64) }], ['com lixo no fim', { token: `${token1}\n` }]]) {
    const r = await http('POST', '/api/conta/confirmar-email', corpo, anonima);
    ok(r.status === 400 && typeof r.json?.erro === 'string', `confirmar com código inválido (${nome}) = 400`, descricao(r));
  }
  ok((await http('GET', '/api/conta', undefined, principal)).status === 401, 'e a conta continua sem sessão');

  // Reenviar: responde igual para contas que existem e que não existem (e só envia quando há uma conta por confirmar)
  const desconhecidoReenvio = await http('POST', '/api/conta/reenviar-confirmacao', { email: `ninguem-${sufixo}@exemplo.pt` }, anonima);
  ok(desconhecidoReenvio.status === 204, 'reenviar para um email sem conta = 204 (não revela se a conta existe)', descricao(desconhecidoReenvio));
  await esperar(400);
  ok((await mensagensPara(`ninguem-${sufixo}@exemplo.pt`)).length === 0, 'e não envia nenhum email');
  ok((await http('POST', '/api/conta/reenviar-confirmacao', {}, anonima)).status === 400, 'reenviar sem email = 400');
  const reenvio1 = await http('POST', '/api/conta/reenviar-confirmacao', { email: emailPrincipal.toUpperCase() }, anonima);
  ok(reenvio1.status === 204, 'reenviar o email de confirmação = 204', descricao(reenvio1));
  const token2 = await ultimoToken(emailPrincipal, 2);
  ok(!!token2 && token2 !== token1 && (await mensagensPara(emailPrincipal)).length === 2, 'chega um segundo email, com um código novo');
  ok((await http('POST', '/api/conta/reenviar-confirmacao', { email: emailPrincipal }, anonima)).status === 204, 'e um terceiro pedido ainda é aceite');
  const token3 = await ultimoToken(emailPrincipal, 3);
  const quarto = await http('POST', '/api/conta/reenviar-confirmacao', { email: emailPrincipal }, anonima);
  ok(quarto.status === 429 && typeof quarto.json?.erro === 'string', 'depois de 3 pedidos para o mesmo email o quarto = 429 (limite)', descricao(quarto));
  await esperar(300);
  ok((await mensagensPara(emailPrincipal)).length === 3, 'e o pedido recusado não envia email');

  // Confirmar com o código do último email; o do primeiro (link aberto outra vez) também continua a servir
  const confirmou = await http('POST', '/api/conta/confirmar-email', { token: token3 }, anonima);
  ok(confirmou.status === 204 && confirmou.setCookie.length === 0, 'confirmar o email com o código do link = 204 (sem iniciar sessão)', descricao(confirmou));
  ok((await http('POST', '/api/conta/confirmar-email', { token: token1 }, anonima)).status === 204, 'abrir um link anterior ou o mesmo link outra vez continua a dar 204');

  // Agora entra
  const entrouPrincipal = await http('POST', '/api/conta/entrar', { email: emailPrincipal, palavraPasse: SENHA }, principal);
  ok(entrouPrincipal.status === 200 && entrouPrincipal.json?.id > 0 && entrouPrincipal.json.email === emailPrincipal && entrouPrincipal.json.nome === `Principal ${sufixo}`,
    'depois de confirmar, entrar = 200 (nome sem espaços, email em minúsculas)', descricao(entrouPrincipal));
  const galleta = entrouPrincipal.setCookie.find((c) => c.startsWith('sessao='));
  ok(!!galleta && /httponly/i.test(galleta) && /samesite=lax/i.test(galleta) && /path=\//i.test(galleta) && /max-age=\d{6,}/i.test(galleta) && !/secure/i.test(galleta),
    'cookie de sessão: HttpOnly, SameSite=Lax, com validade (sem Secure em HTTP simples)', galleta ?? 'sem cookie');
  ok(/^sessao=[0-9a-f]{64}$/.test(principal.cookie ?? ''), 'o código da sessão tem 32 bytes aleatórios (64 hexadecimais)', principal.cookie ?? '');

  const repetido = await http('POST', '/api/conta/registar', { nome: 'Outra', email: emailPrincipal, palavraPasse: SENHA }, new Sessao('repetida'));
  ok(repetido.status === 409 && repetido.json?.codigo === undefined && repetido.setCookie.length === 0, 'registo com o mesmo email de uma conta confirmada = 409 (sem cookie, sem pedir confirmação)', descricao(repetido));

  // Sessão
  const eu = await http('GET', '/api/conta', undefined, principal);
  ok(eu.status === 200 && eu.json?.email === emailPrincipal && eu.json.nome === `Principal ${sufixo}`, 'GET /api/conta com sessão devolve a conta', descricao(eu));
  ok(/no-store/.test(eu.cabecalhos.get('cache-control') ?? ''), 'GET /api/conta sem cache');
  ok((await http('GET', '/api/conta', undefined, Object.assign(new Sessao('falsa'), { cookie: `sessao=${'0'.repeat(64)}` }))).status === 401, 'um código de sessão inventado = 401');

  // A primeira conta de todas herda os dados de exemplo
  const jogos = await http('GET', '/api/jogos');
  ok(jogos.status === 200 && jogos.json?.some((j) => j.id === 2),
    'a primeira conta ficou com os jogos de exemplo (se falhar: usa uma base de dados acabada de criar)', descricao(jogos));

  // Entrar: mesma mensagem para email desconhecido e para palavra-passe errada
  const tmp = new Sessao('temporária');
  const errada = await http('POST', '/api/conta/entrar', { email: emailPrincipal, palavraPasse: 'errada-errada' }, tmp);
  const desconhecido = await http('POST', '/api/conta/entrar', { email: `ninguem-${sufixo}@exemplo.pt`, palavraPasse: SENHA }, tmp);
  ok(errada.status === 401 && desconhecido.status === 401 && errada.json?.erro === desconhecido.json?.erro && errada.setCookie.length === 0,
    'entrar com palavra-passe errada ou email desconhecido: 401 com a mesma mensagem e sem cookie', `${errada.texto} / ${desconhecido.texto}`);
  ok((await http('POST', '/api/conta/entrar', {}, tmp)).status === 401, 'entrar sem email nem palavra-passe = 401');

  const entrada = await http('POST', '/api/conta/entrar', { email: ` ${emailPrincipal.toUpperCase()} `, palavraPasse: SENHA }, tmp);
  ok(entrada.status === 200 && entrada.json?.email === emailPrincipal && /^sessao=[0-9a-f]{64}$/.test(tmp.cookie ?? ''), 'entrar (email com maiúsculas e espaços) = 200 com cookie novo', descricao(entrada));
  ok(tmp.cookie !== principal.cookie, 'cada entrada cria uma sessão nova');

  // Sair: apaga a sessão no servidor (o cookie antigo deixa de servir) e só essa
  const antigo = Object.assign(new Sessao('antiga'), { cookie: tmp.cookie });
  const saida = await http('POST', '/api/conta/sair', undefined, tmp);
  ok(saida.status === 204 && saida.setCookie.some((c) => c.startsWith('sessao=;')) && tmp.cookie === null, 'sair = 204 e o cookie é apagado', `${descricao(saida)} ${saida.setCookie}`);
  ok((await http('GET', '/api/conta', undefined, antigo)).status === 401, 'depois de sair o cookie antigo já não serve (sessão apagada no servidor)');
  ok((await http('GET', '/api/conta', undefined, principal)).status === 200, 'sair numa sessão não termina as outras');
  ok((await http('POST', '/api/conta/sair', undefined, anonima)).status === 204, 'sair sem sessão também é 204');

  // Travão contra tentativas: 5 falhas seguidas para o mesmo email e a 6.ª já é 429
  const alvo = `limite-${sufixo}@exemplo.pt`;
  const estados = [];
  for (let i = 0; i < 6; i++) estados.push((await http('POST', '/api/conta/entrar', { email: alvo, palavraPasse: `errada-${i}-xxxxx` }, tmp)).status);
  ok(estados.slice(0, 5).every((e) => e === 401) && estados[5] === 429, `5 falhas seguidas bloqueiam o email: 401×5 e depois 429 (${estados})`);
  ok((await http('POST', '/api/conta/entrar', { email: emailPrincipal, palavraPasse: SENHA }, tmp)).status === 200, 'o bloqueio é só desse email: a conta principal continua a entrar');

  // Segunda conta: regista, confirma e entra; começa vazia
  const registo2 = await http('POST', '/api/conta/registar', { nome: `Segunda ${sufixo}`, email: emailSegunda, palavraPasse: SENHA }, segunda);
  ok(registo2.status === 201, 'registo da segunda conta = 201', descricao(registo2));
  ok((await http('POST', '/api/conta/confirmar-email', { token: await ultimoToken(emailSegunda) }, anonima)).status === 204, 'a segunda conta confirma o email');
  const entrou2 = await http('POST', '/api/conta/entrar', { email: emailSegunda, palavraPasse: SENHA }, segunda);
  ok(entrou2.status === 200 && entrou2.json?.id !== entrouPrincipal.json?.id, 'a segunda conta entra (conta diferente da primeira)', descricao(entrou2));
  ok((await http('POST', '/api/conta/reenviar-confirmacao', { email: emailSegunda }, anonima)).status === 204, 'reenviar para uma conta já confirmada = 204');
  await esperar(300);
  ok((await mensagensPara(emailSegunda)).length === 1, 'e não envia outro email a quem já confirmou');
  const equipasSegunda = await http('GET', '/api/equipas', undefined, segunda);
  const jogosSegunda = await http('GET', '/api/jogos', undefined, segunda);
  ok(JSON.stringify(equipasSegunda.json) === '[]' && JSON.stringify(jogosSegunda.json) === '[]', 'a segunda conta começa sem equipas nem jogos (não herda os dados de exemplo)', `${equipasSegunda.texto} / ${jogosSegunda.texto}`);
});

// ----------------------------------------------------------------------
await passo('Recuperação da palavra-passe', async () => {
  const email = `recuperar-${sufixo}@exemplo.pt`;
  const NOVA = 'palavra-passe-nova-9';
  const aparelho1 = new Sessao('aparelho 1');
  const aparelho2 = new Sessao('aparelho 2');

  // Pedir o link: valida o email e responde igual exista a conta ou não
  ok((await http('POST', '/api/conta/esqueci-palavra-passe', {}, anonima)).status === 400, 'esqueci a palavra-passe sem email = 400');
  const semConta = await http('POST', '/api/conta/esqueci-palavra-passe', { email: `ninguem-${sufixo}@exemplo.pt` }, anonima);
  ok(semConta.status === 204 && semConta.setCookie.length === 0 && /no-store/.test(semConta.cabecalhos.get('cache-control') ?? ''),
    'esqueci a palavra-passe com um email sem conta = 204 (não revela se existe)', descricao(semConta));
  await esperar(400);
  ok((await mensagensPara(`ninguem-${sufixo}@exemplo.pt`)).length === 0, 'e não envia nenhum email');

  // Uma conta confirmada com duas sessões abertas (dois aparelhos)
  ok((await http('POST', '/api/conta/registar', { nome: `Recuperar ${sufixo}`, email, palavraPasse: SENHA }, anonima)).status === 201, 'conta para recuperar criada');
  ok((await http('POST', '/api/conta/confirmar-email', { token: await ultimoToken(email) }, anonima)).status === 204, 'e confirmada');
  ok((await http('POST', '/api/conta/entrar', { email, palavraPasse: SENHA }, aparelho1)).status === 200
    && (await http('POST', '/api/conta/entrar', { email, palavraPasse: SENHA }, aparelho2)).status === 200, 'com a sessão aberta em dois aparelhos');
  const cookies = [aparelho1.cookie, aparelho2.cookie];

  // Quem errou a palavra-passe 5 vezes fica bloqueado... até a redefinir
  const estados = [];
  for (let i = 0; i < 6; i++) estados.push((await http('POST', '/api/conta/entrar', { email, palavraPasse: `errada-${i}-xxxxx` }, new Sessao('falhas'))).status);
  ok(estados[5] === 429, `a conta ficou bloqueada por tentativas falhadas (${estados})`);

  // Três pedidos de link: três emails; o quarto é travado (e não se mistura com o limite dos emails de confirmação)
  const pedido1 = await http('POST', '/api/conta/esqueci-palavra-passe', { email: email.toUpperCase() }, anonima);
  ok(pedido1.status === 204, 'esqueci a palavra-passe com o email da conta (maiúsculas) = 204', descricao(pedido1));
  const mensagens1 = await esperarMensagens(email, 2);
  const mensagem = await lerMensagem(mensagens1[0].ID);
  const tokenA = tokenDe(mensagem.Text, 'redefinir');
  ok(/palavra-passe/i.test(mensagem.Subject) && mensagem.From?.Address === 'scouting@exemplo.pt', 'chega o email de recuperação (assunto sobre a palavra-passe)', JSON.stringify(mensagem.Subject));
  ok(!!tokenA && mensagem.Text.includes(`${URL_PUBLICO}/redefinir.html?t=${tokenA}`) && mensagem.Text.includes(`Olá Recuperar ${sufixo},`) && mensagem.Text.includes('1 hora'),
    'o email tem o nome e o link para a página de palavra-passe nova no endereço público', mensagem.Text?.slice(0, 200));
  ok(!!tokenA && mensagem.HTML.includes(`redefinir.html?t=${tokenA}`), 'a versão HTML tem o mesmo link');
  ok((await http('POST', '/api/conta/esqueci-palavra-passe', { email }, anonima)).status === 204, 'segundo pedido = 204');
  const tokenB = await ultimoToken(email, 3, 'redefinir');
  ok((await http('POST', '/api/conta/esqueci-palavra-passe', { email }, anonima)).status === 204, 'terceiro pedido = 204');
  const tokenC = await ultimoToken(email, 4, 'redefinir');
  const quarto = await http('POST', '/api/conta/esqueci-palavra-passe', { email }, anonima);
  ok(quarto.status === 429 && typeof quarto.json?.erro === 'string', 'o quarto pedido em 15 minutos = 429', descricao(quarto));
  await esperar(300);
  ok((await mensagensPara(email)).length === 4, 'e o pedido travado não envia email (1 de confirmação + 3 de recuperação)');
  ok(!!tokenB && !!tokenC && new Set([tokenA, tokenB, tokenC]).size === 3, 'cada email traz um código diferente');

  // Códigos e palavras-passe inválidos
  for (const [nome, corpo] of [['sem código', { palavraPasse: NOVA }], ['código curto', { token: 'abc', palavraPasse: NOVA }],
    ['maiúsculas', { token: 'A'.repeat(64), palavraPasse: NOVA }], ['desconhecido', { token: 'f'.repeat(64), palavraPasse: NOVA }], ['com lixo no fim', { token: `${tokenA}\n`, palavraPasse: NOVA }]]) {
    const r = await http('POST', '/api/conta/redefinir-palavra-passe', corpo, anonima);
    ok(r.status === 400 && r.json?.codigo === 'link_invalido' && r.setCookie.length === 0, `palavra-passe nova com código inválido (${nome}) = 400 link_invalido`, descricao(r));
  }
  for (const [nome, palavraPasse, parte] of [['curta', 'curta', 'pelo menos 8'], ['só espaços', ' '.repeat(10), 'só espaços'], ['gigante', 'x'.repeat(129), '128'], ['em falta', undefined, 'pelo menos 8']]) {
    const r = await http('POST', '/api/conta/redefinir-palavra-passe', { token: tokenA, palavraPasse }, anonima);
    ok(r.status === 400 && r.json?.codigo === undefined && r.json?.erro?.includes(parte) && /^[A-ZÁ-Ú]/.test(r.json.erro), `palavra-passe nova ${nome} = 400 com a explicação (e o código não se gasta)`, descricao(r));
  }
  ok((await http('POST', '/api/conta/entrar', { email, palavraPasse: SENHA }, new Sessao('ainda'))).status === 429, 'nada se gastou nem mudou: a conta continua bloqueada pelas tentativas falhadas');

  // Escolher a palavra-passe nova: não inicia sessão, termina as sessões abertas, desbloqueia a conta
  const feito = await http('POST', '/api/conta/redefinir-palavra-passe', { token: tokenB, palavraPasse: NOVA }, anonima);
  ok(feito.status === 204 && feito.setCookie.length === 0 && /no-store/.test(feito.cabecalhos.get('cache-control') ?? ''), 'escolher a palavra-passe nova = 204 (sem iniciar sessão)', descricao(feito));
  for (const [i, cookie] of cookies.entries()) {
    const r = await http('GET', '/api/conta', undefined, Object.assign(new Sessao('antiga'), { cookie }));
    ok(r.status === 401, `a sessão do aparelho ${i + 1} terminou`, descricao(r));
  }
  const antiga = await http('POST', '/api/conta/entrar', { email, palavraPasse: SENHA }, new Sessao('antiga'));
  ok(antiga.status === 401, 'a palavra-passe antiga já não entra', descricao(antiga));
  const nova = await http('POST', '/api/conta/entrar', { email, palavraPasse: NOVA }, aparelho1);
  ok(nova.status === 200 && nova.json?.email === email && aparelho1.cookie !== null && aparelho1.cookie !== cookies[0], 'a palavra-passe nova entra (e o bloqueio por tentativas acabou)', descricao(nova));

  // Cada link só funciona uma vez, e gasta os outros da mesma conta
  for (const [nome, token] of [['o mesmo', tokenB], ['o primeiro', tokenA], ['o terceiro', tokenC]]) {
    const r = await http('POST', '/api/conta/redefinir-palavra-passe', { token, palavraPasse: 'outra-palavra-passe-1' }, anonima);
    ok(r.status === 400 && r.json?.codigo === 'link_invalido', `${nome} link já não serve depois de usado = 400`, descricao(r));
  }
  ok((await http('POST', '/api/conta/entrar', { email, palavraPasse: NOVA }, new Sessao('conferir'))).status === 200, 'e a palavra-passe ficou a escolhida');

  // Quem nunca confirmou o email também recupera a palavra-passe, e o link confirma-lhe o email
  const emailU = `porconfirmar-${sufixo}@exemplo.pt`;
  ok((await http('POST', '/api/conta/registar', { nome: 'Por Confirmar', email: emailU, palavraPasse: SENHA }, anonima)).status === 201, 'conta por confirmar criada');
  ok((await http('POST', '/api/conta/entrar', { email: emailU, palavraPasse: SENHA }, anonima)).status === 403, 'ainda não entra (falta confirmar)');
  ok((await http('POST', '/api/conta/esqueci-palavra-passe', { email: emailU }, anonima)).status === 204, 'pede a recuperação = 204');
  const tokenU = await ultimoToken(emailU, 2, 'redefinir');
  ok(!!tokenU, 'chega o email de recuperação (a seguir ao de confirmação)');
  ok((await http('POST', '/api/conta/redefinir-palavra-passe', { token: tokenU, palavraPasse: NOVA }, anonima)).status === 204, 'escolhe a palavra-passe nova');
  const entrouU = await http('POST', '/api/conta/entrar', { email: emailU, palavraPasse: NOVA }, new Sessao('por confirmar'));
  ok(entrouU.status === 200, 'e entra logo: abrir o link do email também confirmou a conta', descricao(entrouU));
});

// ----------------------------------------------------------------------
await passo('Saúde e dados de exemplo', async () => {
  const saude = await http('GET', '/api/saude');
  ok(saude.status === 200 && saude.json?.estado === 'ok', 'GET /api/saude', descricao(saude));

  const jogos = await http('GET', '/api/jogos');
  ok(jogos.status === 200 && Array.isArray(jogos.json) && jogos.json.length >= 2, 'GET /api/jogos lista os jogos de exemplo', descricao(jogos));

  const tipos = await http('GET', '/api/tipos-evento');
  ok(tipos.status === 200 && tipos.json?.some((t) => t.codigo === 'REMATE' && t.eRemate === true), 'GET /api/tipos-evento', descricao(tipos));

  const detalhe = await http('GET', '/api/jogos/2');
  ok(detalhe.status === 200 && detalhe.json?.jogadores?.length === 16, 'GET /api/jogos/2 devolve os 16 jogadores', descricao(detalhe));
  ok(detalhe.json?.jogadores?.every((j) => j.convocado === true), 'jogo 2: os 16 jogadores estão convocados (dados de exemplo)');
  ok(detalhe.json?.maxConvocados === 16, 'jogo 2: maxConvocados = 16');
  ok(typeof detalhe.json?.dataHora === 'string' && !Number.isNaN(Date.parse(detalhe.json.dataHora)), 'jogo 2: dataHora válida', String(detalhe.json?.dataHora));

  ok((await http('GET', '/api/jogos/99999')).status === 404, 'GET /api/jogos/99999 = 404');
});

// ----------------------------------------------------------------------
await passo('Estatísticas (GROUP BY / COUNT) sobre os dados de exemplo', async () => {
  const est = await http('GET', '/api/jogos/2/estatisticas');
  ok(est.status === 200, 'GET /api/jogos/2/estatisticas', descricao(est));
  const [casa, fora] = est.json?.equipas ?? [];
  ok(casa?.eCasa === true && casa?.golos === 6 && fora?.golos === 9, `placar 6–9 (${casa?.golos}–${fora?.golos})`);
  ok(casa?.remates === 17 && fora?.remates === 16, `remates 17 e 16 (${casa?.remates} e ${fora?.remates})`);
  ok(est.json?.remates?.length === 33, `mapa com 33 remates (${est.json?.remates?.length})`);
  const defesasExemplo = est.json?.remates?.filter((r) => r.resultado === 'DEFESA') ?? [];
  ok(defesasExemplo.length === 11 && defesasExemplo.every((r) => r.balizaX != null && r.balizaY != null && r.balizaZona),
    `jogo 2: as 11 defesas de exemplo têm local na baliza (${defesasExemplo.length})`, JSON.stringify(defesasExemplo[0]));
  ok(est.json.remates.filter((r) => r.resultado !== 'DEFESA').every((r) => r.balizaX == null && r.balizaY == null && r.balizaZona == null),
    'jogo 2: só as defesas têm local na baliza');
  const zonasExemplo = new Set(defesasExemplo.map((r) => r.balizaZona));
  ok(zonasExemplo.size === 9, `jogo 2: as defesas de exemplo cobrem as 9 zonas da baliza (${zonasExemplo.size})`);
  ok(est.json?.parcial?.length === 2 && est.json.parcial.find((p) => p.equipaId === fora?.equipaId)?.golos === 3, 'parcial dos últimos 5 minutos: 3 golos da equipa de fora');
  ok(est.json?.guardaRedes?.length >= 2, 'estatísticas de guarda-redes presentes');
  ok(est.json?.outrosEventos?.length > 0, 'outros eventos (faltas, perdas...) presentes');

  // lateral esquerdo, linha de 9 m, segunda parte
  const e1 = await http('GET', '/api/jogos/2/estatisticas/eficacia?posicao=LE&distancia=LINHA_9M&parte=2');
  ok(e1.status === 200 && e1.json?.resultado?.remates === 2 && e1.json.resultado.golos === 1 && Number(e1.json.resultado.eficacia) === 50,
    'eficácia LE + linha de 9 m + 2.ª parte = 1/2 (50%)', descricao(e1));

  // pontas da equipa 2
  const e2 = await http('GET', '/api/jogos/2/estatisticas/eficacia?equipaId=2&corredor=PONTA');
  ok(e2.status === 200 && e2.json?.resultado?.remates === 5 && e2.json.resultado.golos === 3 && Number(e2.json.resultado.eficacia) === 60,
    'eficácia das pontas da equipa 2 = 3/5 (60%)', descricao(e2));

  const gr = await http('GET', '/api/jogos/2/estatisticas/guarda-redes?corredor=PONTA');
  ok(gr.status === 200 && Array.isArray(gr.json?.guardaRedes), 'defesas dos guarda-redes nos remates das pontas', descricao(gr));

  ok((await http('GET', '/api/jogos/99999/estatisticas')).status === 404, 'estatísticas de jogo inexistente = 404');
  ok((await http('GET', '/api/jogos/99999/estatisticas/eficacia')).status === 404, 'eficácia de jogo inexistente = 404');
});

// ----------------------------------------------------------------------
await passo('Equipas e jogadores (cadastro)', async () => {
  const nomeA = `Teste A ${sufixo}`;
  const criada = await http('POST', '/api/equipas', { nome: nomeA });
  ok(criada.status === 201 && criada.json?.id > 0, 'POST /api/equipas cria a equipa', descricao(criada));
  const equipaA = criada.json?.id;

  const repetida = await http('POST', '/api/equipas', { nome: nomeA });
  ok(repetida.status === 409, 'equipa com nome repetido = 409', descricao(repetida));
  ok((await http('POST', '/api/equipas', { nome: '   ' })).status === 400, 'equipa sem nome = 400');
  ok((await http('POST', '/api/equipas', { nome: 'x'.repeat(81) })).status === 400, 'equipa com nome gigante = 400');

  const lista = await http('GET', '/api/equipas');
  const naLista = lista.json?.find((e) => e.id === equipaA);
  ok(lista.status === 200 && naLista?.nome === nomeA && naLista.jogadores === 0, 'GET /api/equipas inclui a equipa com 0 jogadores', descricao(lista));
  ok(lista.json?.find((e) => e.id === 1)?.jogadores === 8, 'as equipas de exemplo têm 8 jogadores cada');

  ok(JSON.stringify((await http('GET', `/api/equipas/${equipaA}/jogadores`)).json) === '[]', 'plantel novo vazio');
  ok((await http('GET', '/api/equipas/99999/jogadores')).status === 404, 'plantel de equipa inexistente = 404');

  // jogadores
  const j1 = await http('POST', `/api/equipas/${equipaA}/jogadores`, { numero: 1, nome: '  Rui Teste ', posicao: 'GR' });
  ok(j1.status === 201 && j1.json?.id > 0, 'POST jogador (guarda-redes)', descricao(j1));
  const j2 = await http('POST', `/api/equipas/${equipaA}/jogadores`, { numero: 9, nome: 'Tiago Teste', posicao: 'LE' });
  ok(j2.status === 201, 'POST jogador (lateral esquerdo)', descricao(j2));
  ok((await http('POST', `/api/equipas/${equipaA}/jogadores`, { numero: 9, nome: 'Outro', posicao: 'PE' })).status === 409, 'número repetido na equipa = 409');
  ok((await http('POST', `/api/equipas/${equipaA}/jogadores`, { numero: 0, nome: 'X', posicao: 'PE' })).status === 400, 'número 0 = 400');
  ok((await http('POST', `/api/equipas/${equipaA}/jogadores`, { numero: 100, nome: 'X', posicao: 'PE' })).status === 400, 'número 100 = 400');
  ok((await http('POST', `/api/equipas/${equipaA}/jogadores`, { numero: 5, nome: '', posicao: 'PE' })).status === 400, 'nome vazio = 400');
  ok((await http('POST', `/api/equipas/${equipaA}/jogadores`, { numero: 5, nome: 'X', posicao: 'ZZ' })).status === 400, 'posição inválida = 400');
  ok((await http('POST', '/api/equipas/99999/jogadores', { numero: 5, nome: 'X', posicao: 'PE' })).status === 404, 'jogador numa equipa inexistente = 404');

  let plantel = (await http('GET', `/api/equipas/${equipaA}/jogadores`)).json ?? [];
  ok(plantel.length === 2 && plantel[0].numero === 1 && plantel[0].nome === 'Rui Teste' && plantel[0].posicao === 'GR' && plantel[0].eventos === 0,
    'plantel ordenado por número, nome sem espaços, 0 eventos', JSON.stringify(plantel));

  // editar
  const jogadorId = j2.json?.id;
  const editado = await http('PUT', `/api/jogadores/${jogadorId}`, { numero: 10, nome: 'Tiago Editado', posicao: 'LD' });
  ok(editado.status === 204, 'PUT jogador = 204', descricao(editado));
  plantel = (await http('GET', `/api/equipas/${equipaA}/jogadores`)).json ?? [];
  const alterado = plantel.find((j) => j.id === jogadorId);
  ok(alterado?.numero === 10 && alterado.nome === 'Tiago Editado' && alterado.posicao === 'LD', 'edição visível no plantel', JSON.stringify(alterado));
  ok((await http('PUT', `/api/jogadores/${jogadorId}`, { numero: 1, nome: 'Conflito', posicao: 'LD' })).status === 409, 'editar para número já usado = 409');
  ok((await http('PUT', '/api/jogadores/99999', { numero: 3, nome: 'X', posicao: 'LD' })).status === 404, 'editar jogador inexistente = 404');
  ok((await http('PUT', `/api/jogadores/${jogadorId}`, { numero: 3, nome: 'X', posicao: '??' })).status === 400, 'editar com posição inválida = 400');

  // apagar
  const extra = await http('POST', `/api/equipas/${equipaA}/jogadores`, { numero: 33, nome: 'Para apagar', posicao: 'PV' });
  ok((await http('DELETE', `/api/jogadores/${extra.json?.id}`)).status === 204, 'DELETE jogador sem eventos = 204');
  ok((await http('DELETE', `/api/jogadores/${extra.json?.id}`)).status === 404, 'apagar outra vez = 404');
  const comEventos = await http('DELETE', '/api/jogadores/4');
  ok(comEventos.status === 409, 'apagar jogador com eventos = 409', descricao(comEventos));
  const doExemplo = (await http('GET', '/api/equipas/1/jogadores')).json ?? [];
  ok(doExemplo.find((j) => j.id === 4)?.eventos > 0, 'o plantel de exemplo mostra os eventos de cada jogador');

  // segunda equipa com guarda-redes e remateiro, para o jogo
  const equipaB = (await http('POST', '/api/equipas', { nome: `Teste B ${sufixo}` })).json?.id;
  const grB = (await http('POST', `/api/equipas/${equipaB}/jogadores`, { numero: 12, nome: 'GR B', posicao: 'GR' })).json?.id;
  const lateralB = (await http('POST', `/api/equipas/${equipaB}/jogadores`, { numero: 7, nome: 'LE B', posicao: 'LE' })).json?.id;
  jogoNovo = { casaId: equipaA, foraId: equipaB, grCasa: j1.json?.id, lateralCasa: jogadorId, grFora: grB, lateralFora: lateralB };
});

// ----------------------------------------------------------------------
await passo('Novo jogo', async () => {
  if (!jogoNovo) return ok(false, 'sem equipas do passo anterior');
  const { casaId, foraId } = jogoNovo;

  ok((await http('POST', '/api/jogos', { casaId, foraId: casaId })).status === 400, 'jogo de uma equipa contra ela própria = 400');
  ok((await http('POST', '/api/jogos', { casaId, foraId: 99999 })).status === 400, 'jogo com equipa inexistente = 400');
  ok((await http('POST', '/api/jogos', { casaId, foraId, local: 'x'.repeat(121) })).status === 400, 'local gigante = 400');

  const criado = await http('POST', '/api/jogos', { casaId, foraId, local: ' Pavilhão Teste ', dataHora: '2026-11-20T18:30:00+01:00' });
  ok(criado.status === 201 && criado.json?.id > 0, 'POST /api/jogos (com data e hora com fuso)', descricao(criado));
  jogoNovo.id = criado.json?.id;

  const detalhe = await http('GET', `/api/jogos/${jogoNovo.id}`);
  ok(detalhe.json?.local === 'Pavilhão Teste', 'local guardado sem espaços', String(detalhe.json?.local));
  ok(new Date(detalhe.json?.dataHora).toISOString() === '2026-11-20T17:30:00.000Z', 'data e hora convertidas para UTC', String(detalhe.json?.dataHora));
  ok(detalhe.json?.jogadores?.length === 4 && detalhe.json.jogadores.every((j) => j.convocado === false), 'jogo novo: 4 jogadores, nenhum convocado');

  const semData = await http('POST', '/api/jogos', { casaId, foraId });
  ok(semData.status === 201, 'POST /api/jogos sem data nem local', descricao(semData));
  const semDataDetalhe = await http('GET', `/api/jogos/${semData.json?.id}`);
  ok(Math.abs(Date.now() - Date.parse(semDataDetalhe.json?.dataHora)) < 5 * 60 * 1000 && semDataDetalhe.json?.local === null, 'sem data: usa a hora atual; sem local: null');

  const todos = await http('GET', '/api/jogos');
  const nosJogos = todos.json?.find((j) => j.id === jogoNovo.id);
  ok(nosJogos?.golosCasa === 0 && nosJogos?.golosFora === 0, 'o jogo novo aparece na lista com 0–0');
});

// ----------------------------------------------------------------------
await passo('Convocatória', async () => {
  if (!jogoNovo?.id) return ok(false, 'sem jogo do passo anterior');
  const { id, grCasa, lateralCasa, grFora, lateralFora, casaId } = jogoNovo;
  const caminho = `/api/jogos/${id}/convocados`;

  const vazia = await http('GET', caminho);
  ok(vazia.status === 200 && vazia.json?.jogadorIds?.length === 0 && vazia.json?.maximoPorEquipa === 16, 'convocatória inicial vazia, máximo 16', descricao(vazia));
  ok((await http('GET', '/api/jogos/99999/convocados')).status === 404, 'convocatória de jogo inexistente = 404');

  const guardada = await http('PUT', caminho, { jogadorIds: [grCasa, lateralCasa, grFora] });
  ok(guardada.status === 204, 'PUT convocados = 204', descricao(guardada));
  const lida = await http('GET', caminho);
  ok(JSON.stringify([...(lida.json?.jogadorIds ?? [])].sort((a, b) => a - b)) === JSON.stringify([grCasa, lateralCasa, grFora].sort((a, b) => a - b)), 'GET convocados devolve os guardados', descricao(lida));

  const detalhe = await http('GET', `/api/jogos/${id}`);
  const marcados = detalhe.json?.jogadores?.filter((j) => j.convocado).map((j) => j.id).sort((a, b) => a - b);
  ok(JSON.stringify(marcados) === JSON.stringify([grCasa, lateralCasa, grFora].sort((a, b) => a - b)), 'o detalhe do jogo marca quem está convocado');

  // substituir (não acumular)
  ok((await http('PUT', caminho, { jogadorIds: [lateralFora, lateralFora, grCasa] })).status === 204, 'PUT substitui a lista (ids repetidos aceites)');
  const substituida = (await http('GET', caminho)).json?.jogadorIds ?? [];
  ok(substituida.length === 2 && substituida.includes(lateralFora) && substituida.includes(grCasa), 'a lista anterior foi substituída', JSON.stringify(substituida));

  // erros
  ok((await http('PUT', caminho, { jogadorIds: [1] })).status === 400, 'jogador de outra equipa = 400');
  ok((await http('PUT', caminho, { jogadorIds: [99999] })).status === 400, 'jogador inexistente = 400');
  ok((await http('PUT', caminho, {})).status === 400, 'sem jogadorIds = 400');
  ok((await http('PUT', '/api/jogos/99999/convocados', { jogadorIds: [] })).status === 404, 'PUT em jogo inexistente = 404');
  const depoisDosErros = (await http('GET', caminho)).json?.jogadorIds ?? [];
  ok(depoisDosErros.length === 2, 'os pedidos recusados não alteraram a convocatória');

  // máximo de 16 por equipa
  const ids = [];
  for (let n = 40; n < 57; n++) {
    const r = await http('POST', `/api/equipas/${casaId}/jogadores`, { numero: n, nome: `Extra ${n}`, posicao: 'LE' });
    ids.push(r.json?.id);
  }
  const mais = await http('PUT', caminho, { jogadorIds: ids });
  ok(mais.status === 400 && /16/.test(mais.texto), '17 convocados na mesma equipa = 400', descricao(mais));
  const dezasseis = await http('PUT', caminho, { jogadorIds: ids.slice(0, 16) });
  ok(dezasseis.status === 204, '16 convocados na mesma equipa = 204', descricao(dezasseis));

  // limpar
  ok((await http('PUT', caminho, { jogadorIds: [] })).status === 204, 'PUT com lista vazia = 204');
  ok((await http('GET', caminho)).json?.jogadorIds?.length === 0, 'convocatória limpa');

  // o jogo de exemplo não foi tocado
  ok(((await http('GET', '/api/jogos/2/convocados')).json?.jogadorIds?.length) === 16, 'o jogo 2 continua com 16 convocados');
});

// ----------------------------------------------------------------------
await passo('Eventos e tempo real (SignalR / WebSockets)', async () => {
  if (!jogoNovo?.id) return ok(false, 'sem jogo do passo anterior');
  const { id, casaId, foraId, lateralCasa, grFora } = jogoNovo;

  const recebidos = [];
  const ligacao = ligarHub(principal, signalR.LogLevel.Warning);
  ligacao.on('EstatisticasAtualizadas', (estado) => recebidos.push(estado));

  await ligacao.start();
  ok(ligacao.state === signalR.HubConnectionState.Connected, 'ligação ao hub /hub/jogo');
  const inicial = await ligacao.invoke('EntrarNoJogo', id, null);
  ok(inicial?.jogoId === id && inicial.equipas?.length === 2, 'EntrarNoJogo devolve o estado atual', JSON.stringify(inicial)?.slice(0, 120));

  ok(await hubRecusa(ligacao, 99999, null), 'EntrarNoJogo de jogo inexistente dá erro "Jogo não encontrado."');

  const remate = { tipoEvento: 'REMATE', equipaId: casaId, jogadorId: lateralCasa, guardaRedesId: grFora, resultado: 'GOLO', situacao: 'POSICIONAL', x: 50, y: 25, parte: 1, segundoJogo: 120 };

  // validações
  ok((await http('POST', `/api/jogos/${id}/eventos`, { ...remate, x: undefined })).status === 400, 'remate sem coordenadas = 400');
  ok((await http('POST', `/api/jogos/${id}/eventos`, { ...remate, resultado: 'ENTROU' })).status === 400, 'resultado inválido = 400');
  ok((await http('POST', `/api/jogos/${id}/eventos`, { ...remate, parte: 3 })).status === 400, 'parte 3 = 400');
  ok((await http('POST', `/api/jogos/${id}/eventos`, { ...remate, jogadorId: grFora })).status === 400, 'jogador de outra equipa = 400');
  ok((await http('POST', `/api/jogos/${id}/eventos`, { ...remate, guardaRedesId: lateralFora(jogoNovo) })).status === 400, 'guarda-redes que não é guarda-redes = 400');
  ok((await http('POST', `/api/jogos/${id}/eventos`, { ...remate, tipoEvento: 'NAO_EXISTE' })).status === 400, 'tipo de evento inexistente = 400');
  ok((await http('POST', '/api/jogos/99999/eventos', remate)).status === 404, 'evento num jogo inexistente = 404');
  const defesaBaliza = { ...remate, resultado: 'DEFESA', balizaX: 50, balizaY: 50 };
  ok((await http('POST', `/api/jogos/${id}/eventos`, { ...defesaBaliza, balizaY: undefined })).status === 400, 'baliza: só o X sem o Y = 400');
  ok((await http('POST', `/api/jogos/${id}/eventos`, { ...defesaBaliza, balizaX: undefined })).status === 400, 'baliza: só o Y sem o X = 400');
  ok((await http('POST', `/api/jogos/${id}/eventos`, { ...defesaBaliza, balizaX: 100.5 })).status === 400, 'baliza: X acima de 100 = 400');
  ok((await http('POST', `/api/jogos/${id}/eventos`, { ...defesaBaliza, balizaY: -1 })).status === 400, 'baliza: Y abaixo de 0 = 400');
  ok((await http('POST', `/api/jogos/${id}/eventos`, { ...remate, balizaX: 50, balizaY: 50 })).status === 400, 'baliza: um golo não tem local de defesa = 400');
  ok((await http('POST', `/api/jogos/${id}/eventos`, { tipoEvento: 'FALTA_OFENSIVA', equipaId: casaId, jogadorId: lateralCasa, parte: 1, segundoJogo: 200, balizaX: 50, balizaY: 50 })).status === 400, 'baliza: uma falta não tem local na baliza = 400');
  ok(recebidos.length === 0, 'pedidos recusados não enviam nada ao dashboard');

  // golo -> o dashboard recebe a atualização
  const golo = await http('POST', `/api/jogos/${id}/eventos`, remate);
  ok(golo.status === 201 && golo.json?.id > 0, 'POST remate (golo) = 201', descricao(golo));
  ok(await ate(() => recebidos.length >= 1), 'o dashboard recebe EstatisticasAtualizadas após o golo');
  const casa = recebidos.at(-1)?.equipas?.find((e) => e.equipaId === casaId);
  ok(casa?.golos === 1 && casa?.remates === 1, 'o estado recebido tem 1 golo e 1 remate', JSON.stringify(casa));
  ok(recebidos.at(-1)?.remates?.length === 1 && Number(recebidos.at(-1).remates[0].x) === 50, 'o mapa recebido tem o remate nas coordenadas enviadas');

  // defesa e evento sem resultado
  const defesa = await http('POST', `/api/jogos/${id}/eventos`, { ...remate, resultado: 'DEFESA', x: 20, y: 60, segundoJogo: 180, balizaX: 83.5, balizaY: 91.2 });
  ok(defesa.status === 201, 'POST remate (defesa com local na baliza)', descricao(defesa));
  const falta = await http('POST', `/api/jogos/${id}/eventos`, { tipoEvento: 'FALTA_OFENSIVA', equipaId: casaId, jogadorId: lateralCasa, parte: 1, segundoJogo: 200 });
  ok(falta.status === 201, 'POST falta ofensiva sem resultado nem coordenadas', descricao(falta));
  ok(await ate(() => recebidos.length >= 3), 'mais duas atualizações recebidas');
  const ultimo = recebidos.at(-1);
  ok(ultimo.equipas.find((e) => e.equipaId === casaId)?.remates === 2 && ultimo.outrosEventos.some((o) => o.tipo === 'FALTA_OFENSIVA' && o.total === 1), 'estado com 2 remates e 1 falta ofensiva');
  const gr = ultimo.guardaRedes.find((g) => g.jogadorId === grFora);
  ok(gr?.defesas === 1 && gr.golosSofridos === 1 && Number(gr.percentagemDefesa) === 50, 'guarda-redes adversário: 1 defesa, 1 golo sofrido, 50%', JSON.stringify(gr));

  // as estatísticas por HTTP batem com as recebidas
  const http_ = await http('GET', `/api/jogos/${id}/estatisticas`);
  ok(http_.json?.equipas?.find((e) => e.equipaId === casaId)?.remates === 2, 'GET estatísticas coincide com o tempo real');

  // local da defesa na baliza: chega ao mapa e aos últimos eventos
  const defesaMapa = ultimo.remates.find((r) => r.id === defesa.json.id);
  ok(Number(defesaMapa?.balizaX) === 83.5 && Number(defesaMapa?.balizaY) === 91.2 && defesaMapa?.balizaZona === 'BAIXO_DIR',
    'baliza: o remate recebido traz o local e a zona (baixo à direita)', JSON.stringify(defesaMapa));
  ok(ultimo.ultimosEventos.find((e) => e.id === defesa.json.id)?.balizaZona === 'BAIXO_DIR', 'baliza: os últimos eventos trazem a zona da defesa');
  const golosNoMapa = ultimo.remates.find((r) => r.resultado === 'GOLO');
  ok(golosNoMapa && golosNoMapa.balizaX == null && golosNoMapa.balizaZona == null, 'baliza: o golo não tem local de defesa');

  // defesa sem local (continua válida)
  const semLocal = await http('POST', `/api/jogos/${id}/eventos`, { ...remate, resultado: 'DEFESA', x: 25, y: 70, segundoJogo: 190 });
  ok(semLocal.status === 201, 'POST remate (defesa sem local na baliza)', descricao(semLocal));
  ok(await ate(() => recebidos.length >= 4), 'a defesa sem local também atualiza o dashboard');
  const semLocalMapa = recebidos.at(-1).remates.find((r) => r.id === semLocal.json.id);
  ok(semLocalMapa && semLocalMapa.balizaX == null && semLocalMapa.balizaY == null && semLocalMapa.balizaZona == null,
    'baliza: a defesa sem local fica sem coordenadas nem zona', JSON.stringify(semLocalMapa));
  ok(recebidos.at(-1).remates.filter((r) => r.balizaZona != null).length === 1, 'baliza: só uma das duas defesas tem local');

  // apagar -> nova atualização
  const antes = recebidos.length;
  ok((await http('DELETE', `/api/jogos/${id}/eventos/${golo.json.id}`)).status === 204, 'DELETE evento = 204');
  ok(await ate(() => recebidos.length > antes), 'o dashboard recebe a atualização após apagar');
  ok(recebidos.at(-1).equipas.find((e) => e.equipaId === casaId)?.golos === 0, 'depois de apagar o golo, 0 golos');
  ok((await http('DELETE', `/api/jogos/${id}/eventos/${golo.json.id}`)).status === 404, 'apagar o mesmo evento outra vez = 404');
  ok((await http('DELETE', `/api/jogos/99999/eventos/${defesa.json.id}`)).status === 404, 'apagar evento com jogo errado = 404');

  // um segundo cliente noutro jogo não recebe nada deste
  const outro = ligarHub(principal);
  const doOutroJogo = [];
  outro.on('EstatisticasAtualizadas', (e) => doOutroJogo.push(e));
  await outro.start();
  await outro.invoke('EntrarNoJogo', 2, null);
  await http('POST', `/api/jogos/${id}/eventos`, { ...remate, segundoJogo: 300 });
  await esperar(500);
  ok(doOutroJogo.length === 0, 'quem está noutro jogo não recebe as atualizações deste');
  await outro.stop();

  await ligacao.stop();
  ok(true, 'ligações fechadas');
});

function lateralFora(j) { return j.lateralFora; }

// ----------------------------------------------------------------------
await passo('Cada conta só vê e altera o que é seu', async () => {
  if (!jogoNovo?.id) return ok(false, 'sem jogo do passo anterior');
  const dadosJogo2 = (await http('GET', '/api/jogos/2/estatisticas')).json;
  const eventoAlheio = dadosJogo2?.ultimosEventos?.[0]?.id;
  ok(eventoAlheio > 0, 'o jogo 2 tem eventos da conta principal', JSON.stringify(dadosJogo2?.ultimosEventos?.[0]));
  const remate = { tipoEvento: 'REMATE', equipaId: 1, jogadorId: 4, guardaRedesId: null, resultado: 'GOLO', situacao: 'POSICIONAL', x: 50, y: 25, parte: 1, segundoJogo: 10 };
  const nome4 = (await http('GET', '/api/equipas/1/jogadores')).json?.find((j) => j.id === 4)?.nome;

  // Tudo o que é da conta principal "não existe" para a segunda (404, nunca 403: nem se revela que existe)
  const alheios = [
    ['GET', '/api/jogos/2'], ['GET', '/api/jogos/2/estatisticas'], ['GET', '/api/jogos/2/estatisticas/eficacia'],
    ['GET', '/api/jogos/2/estatisticas/guarda-redes'], ['GET', '/api/jogos/2/exportar.xlsx'], ['GET', '/api/jogos/2/convocados'],
    ['PUT', '/api/jogos/2/convocados', { jogadorIds: [] }],
    ['POST', '/api/jogos/2/eventos', remate], ['DELETE', `/api/jogos/2/eventos/${eventoAlheio}`],
    ['GET', '/api/equipas/1/jogadores'], ['POST', '/api/equipas/1/jogadores', { numero: 77, nome: 'Intruso', posicao: 'PV' }],
    ['PUT', '/api/jogadores/4', { numero: 4, nome: 'Alterado', posicao: 'PV' }], ['DELETE', '/api/jogadores/4'],
    ['GET', `/api/jogos/${jogoNovo.id}`],
  ];
  for (const [metodo, caminho, corpo] of alheios) {
    const r = await http(metodo, caminho, corpo, segunda);
    ok(r.status === 404, `conta alheia: ${metodo} ${caminho} = 404`, descricao(r));
  }
  const listas = [(await http('GET', '/api/equipas', undefined, segunda)).json, (await http('GET', '/api/jogos', undefined, segunda)).json];
  ok(listas.every((l) => Array.isArray(l) && l.length === 0), 'conta alheia: as listas de equipas e jogos continuam vazias');
  const jogoComEquipaAlheia = await http('POST', '/api/jogos', { casaId: 1, foraId: 2 }, segunda);
  ok(jogoComEquipaAlheia.status === 400, 'criar um jogo com equipas de outra conta = 400', descricao(jogoComEquipaAlheia));

  // Nada mudou na conta principal
  const depois = (await http('GET', '/api/jogos/2/estatisticas')).json;
  ok(depois?.remates?.length === 33 && depois.ultimosEventos.some((e) => e.id === eventoAlheio), 'os pedidos da conta alheia não apagaram nem criaram eventos no jogo 2');
  ok((await http('GET', '/api/jogos/2/convocados')).json?.jogadorIds?.length === 16, 'nem alteraram a convocatória do jogo 2');
  ok((await http('GET', '/api/equipas/1/jogadores')).json?.find((j) => j.id === 4)?.nome === nome4, 'nem o plantel da equipa 1');

  // O mesmo nome de equipa pode existir em contas diferentes; dentro da mesma conta não
  const a = await http('POST', '/api/equipas', { nome: 'Águias do Norte' }, segunda);
  ok(a.status === 201, 'a segunda conta pode ter uma equipa com o mesmo nome da primeira', descricao(a));
  ok((await http('POST', '/api/equipas', { nome: 'Águias do Norte' }, segunda)).status === 409, 'mas não duas com o mesmo nome na mesma conta');
  const b = await http('POST', '/api/equipas', { nome: `Equipa B ${sufixo}` }, segunda);
  const meuJogo = await http('POST', '/api/jogos', { casaId: a.json?.id, foraId: b.json?.id }, segunda);
  ok(meuJogo.status === 201, 'a segunda conta cria o seu jogo', descricao(meuJogo));
  ok((await http('POST', '/api/jogos', { casaId: a.json?.id, foraId: 1 }, principal)).status === 400, 'a conta principal não consegue juntar uma equipa da segunda a um jogo seu');
  ok((await http('GET', `/api/jogos/${meuJogo.json?.id}`, undefined, principal)).status === 404, 'o jogo da segunda conta "não existe" para a principal');
  ok((await http('GET', '/api/jogos', undefined, principal)).json?.every((j) => j.id !== meuJogo.json?.id), 'e não aparece na lista da principal');
  ok((await http('GET', '/api/jogos', undefined, segunda)).json?.length === 1, 'a lista da segunda conta tem só o seu jogo');

  // Tempo real: o hub aplica as mesmas regras
  const hubSegunda = ligarHub(segunda);
  await hubSegunda.start();
  ok(await hubRecusa(hubSegunda, 2, null), 'hub: a conta alheia não entra no jogo 2');
  const proprio = await hubSegunda.invoke('EntrarNoJogo', meuJogo.json?.id, null);
  ok(proprio?.jogoId === meuJogo.json?.id, 'hub: a segunda conta entra no seu próprio jogo');
  await hubSegunda.stop();
  const hubAnonimo = ligarHub(anonima);
  await hubAnonimo.start();
  ok(await hubRecusa(hubAnonimo, 2, null), 'hub: sem sessão nem código não entra');
  ok(await hubRecusa(hubAnonimo, meuJogo.json?.id, null), 'hub: sem sessão nem código não entra (jogo da segunda conta)');
  await hubAnonimo.stop();
});

// ----------------------------------------------------------------------
await passo('Link de partilha: ver o jogo em direto sem conta', async () => {
  if (!jogoNovo?.id) return ok(false, 'sem jogo do passo anterior');
  const lista = (await http('GET', '/api/jogos')).json ?? [];
  const codigo2 = lista.find((j) => j.id === 2)?.codigo;
  const codigoNovo = lista.find((j) => j.id === jogoNovo.id)?.codigo;
  const formato = /^[0-9a-f]{20}$/;
  ok(formato.test(codigo2 ?? '') && formato.test(codigoNovo ?? '') && codigo2 !== codigoNovo, `cada jogo tem o seu código de partilha de 20 caracteres (${codigo2}, ${codigoNovo})`);
  const doDetalhe = (await http('GET', '/api/jogos/2')).json?.codigo;
  ok(doDetalhe === codigo2, 'o dono vê o mesmo código no detalhe do jogo');

  // Quem tem o link lê (sem sessão)
  const c = encodeURIComponent(codigo2);
  const detalhe = await http('GET', `/api/jogos/2?c=${c}`, undefined, anonima);
  ok(detalhe.status === 200 && detalhe.json?.jogadores?.length === 16, 'com o código: GET /api/jogos/2 = 200', descricao(detalhe));
  const est = await http('GET', `/api/jogos/2/estatisticas?c=${c}`, undefined, anonima);
  ok(est.status === 200 && est.json?.equipas?.[0]?.golos === 6 && est.json.equipas[1].golos === 9, 'com o código: estatísticas em direto = 200 (6–9)', descricao(est));
  ok((await http('GET', `/api/jogos/2/estatisticas/eficacia?c=${c}&equipaId=2&corredor=PONTA`, undefined, anonima)).status === 200, 'com o código: eficácia com filtros = 200');
  ok((await http('GET', `/api/jogos/2/estatisticas/guarda-redes?c=${c}`, undefined, anonima)).status === 200, 'com o código: guarda-redes = 200');
  const excel = await bruto(`/api/jogos/2/exportar.xlsx?c=${c}`, anonima);
  const bytesExcel = Buffer.from(await excel.arrayBuffer());
  ok(excel.status === 200 && bytesExcel[0] === 0x50 && bytesExcel[1] === 0x4b, 'com o código: exportar para Excel = 200 (ZIP)', `HTTP ${excel.status}`);
  const excelEquipa = await bruto(`/api/jogos/2/exportar.xlsx?equipaId=2&c=${c}`, anonima);
  ok(excelEquipa.status === 200, 'com o código: Excel só de uma equipa = 200', `HTTP ${excelEquipa.status}`);

  // Códigos que não servem
  const falsos = [
    ['código errado', '0123456789abcdef0123'], ['código vazio', ''], ['código de outro jogo', codigoNovo],
    ['código com um carácter a menos', codigo2.slice(0, 19)], ['injeção SQL', "' OR '1'='1"],
  ];
  for (const [nome, valor] of falsos) {
    const r = await http('GET', `/api/jogos/2/estatisticas?c=${encodeURIComponent(valor)}`, undefined, anonima);
    ok(r.status === 404, `${nome}: 404`, descricao(r));
  }

  // O link só deixa ler: registar, apagar e listar continuam a exigir conta
  const escrita = [
    ['POST', `/api/jogos/2/eventos?c=${c}`, { tipoEvento: 'REMATE' }], ['DELETE', `/api/jogos/2/eventos/1?c=${c}`],
    ['PUT', `/api/jogos/2/convocados?c=${c}`, { jogadorIds: [] }], ['GET', `/api/jogos/2/convocados?c=${c}`],
    ['GET', `/api/jogos?c=${c}`], ['GET', `/api/equipas?c=${c}`], ['GET', `/api/equipas/1/jogadores?c=${c}`],
  ];
  for (const [metodo, caminho, corpo] of escrita) {
    const r = await http(metodo, caminho, corpo, anonima);
    ok(r.status === 401, `com o código mas sem conta: ${metodo} ${caminho.split('?')[0]} = 401`, descricao(r));
  }
  ok((await http('GET', '/api/jogos/2/estatisticas', undefined, anonima)).status === 404, 'o código não fica "guardado": sem ele volta a ser 404');

  // Uma conta que não é a dona também pode ver com o link, mas não regista
  ok((await http('GET', `/api/jogos/2?c=${c}`, undefined, segunda)).status === 200, 'uma conta que não é a dona vê o jogo com o código');
  ok((await http('POST', `/api/jogos/2/eventos?c=${c}`, { tipoEvento: 'REMATE', equipaId: 1, jogadorId: 4, resultado: 'GOLO', situacao: 'POSICIONAL', x: 50, y: 25, parte: 1, segundoJogo: 5 }, segunda)).status === 404,
    'mas essa conta não consegue registar eventos nele (404)');
  ok((await http('GET', '/api/jogos/2/estatisticas')).json?.remates?.length === 33, 'o jogo 2 continua com 33 remates');

  // Tempo real para quem só tem o link
  const visitante = ligarHub(anonima);
  const recebidos = [];
  visitante.on('EstatisticasAtualizadas', (e) => recebidos.push(e));
  await visitante.start();
  ok(await hubRecusa(visitante, jogoNovo.id, null), 'hub: sem código não entra');
  ok(await hubRecusa(visitante, jogoNovo.id, codigo2), 'hub: o código de outro jogo não serve');
  ok(await hubRecusa(visitante, jogoNovo.id, '0123456789abcdef0123'), 'hub: código errado não entra');
  const inicial = await visitante.invoke('EntrarNoJogo', jogoNovo.id, codigoNovo);
  ok(inicial?.jogoId === jogoNovo.id && inicial.equipas?.length === 2, 'hub: com o código entra e recebe o estado atual', JSON.stringify(inicial)?.slice(0, 100));
  const golosAntes = inicial?.equipas?.find((e) => e.equipaId === jogoNovo.casaId)?.golos ?? 0;

  const golo = await http('POST', `/api/jogos/${jogoNovo.id}/eventos`, {
    tipoEvento: 'REMATE', equipaId: jogoNovo.casaId, jogadorId: jogoNovo.lateralCasa, guardaRedesId: jogoNovo.grFora,
    resultado: 'GOLO', situacao: 'POSICIONAL', x: 40, y: 30, parte: 1, segundoJogo: 600,
  });
  ok(golo.status === 201, 'a conta dona regista um golo', descricao(golo));
  ok(await ate(() => recebidos.length >= 1), 'o visitante recebe a atualização em direto, sem conta');
  const golosVistos = recebidos.at(-1)?.equipas?.find((e) => e.equipaId === jogoNovo.casaId)?.golos;
  ok(golosVistos === golosAntes + 1, `e o estado recebido já tem o golo novo (${golosAntes} -> ${golosVistos})`);
  await http('DELETE', `/api/jogos/${jogoNovo.id}/eventos/${golo.json?.id}`);
  await visitante.stop();

  // Sair da conta tira o acesso de dono (também ao hub), mesmo para quem ainda tem o cookie antigo
  const cookieAntigo = principal.cookie;
  const aSair = Object.assign(new Sessao('a sair'), { cookie: cookieAntigo });
  await http('POST', '/api/conta/sair', undefined, aSair);
  const velha = Object.assign(new Sessao('velha'), { cookie: cookieAntigo });
  ok((await http('GET', '/api/jogos/2/estatisticas', undefined, velha)).status === 404, 'depois de sair, o cookie antigo já não dá acesso ao jogo sem o código');
  const hubDepois = ligarHub(velha);
  await hubDepois.start();
  ok(await hubRecusa(hubDepois, 2, null), 'hub: depois de sair, o cookie antigo já não entra no jogo sem o código');
  await hubDepois.stop();
  // volta a entrar para os passos seguintes
  const reentrada = await http('POST', '/api/conta/entrar', { email: emailPrincipal, palavraPasse: SENHA }, principal);
  ok(reentrada.status === 200, 'a conta principal volta a entrar', descricao(reentrada));
});

// ----------------------------------------------------------------------
await passo('Exportação para Excel', async () => {
  async function descarregar(caminho, ficheiro) {
    const r = await bruto(caminho);
    const bytes = Buffer.from(await r.arrayBuffer());
    if (ficheiro && r.status === 200) fs.writeFileSync(path.join(EXCEL_DIR, ficheiro), bytes);
    return { r, bytes };
  }

  const { r, bytes } = await descarregar('/api/jogos/2/exportar.xlsx', 'jogo-2.xlsx');
  ok(r.status === 200, 'GET /api/jogos/2/exportar.xlsx = 200', `HTTP ${r.status}`);
  ok(r.headers.get('content-type') === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'tipo de conteúdo do .xlsx', String(r.headers.get('content-type')));
  const disposicao = r.headers.get('content-disposition') ?? '';
  ok(/attachment/i.test(disposicao) && disposicao.includes('estatisticas-aguias-do-norte-vs-leoes-do-sul.xlsx'), 'descarrega como estatisticas-aguias-do-norte-vs-leoes-do-sul.xlsx', disposicao);
  ok(bytes.length > 2000 && bytes[0] === 0x50 && bytes[1] === 0x4b, 'o ficheiro é um ZIP (começa por PK)', `${bytes.length} bytes`);
  ok(/no-store/.test(r.headers.get('cache-control') ?? ''), 'resposta sem cache');

  const equipa = await descarregar('/api/jogos/2/exportar.xlsx?equipaId=2', 'jogo-2-equipa-2.xlsx');
  ok(equipa.r.status === 200 && (equipa.r.headers.get('content-disposition') ?? '').includes('estatisticas-leoes-do-sul-aguias-do-norte-vs-leoes-do-sul.xlsx'), 'exportar só a equipa 2: nome do ficheiro', equipa.r.headers.get('content-disposition') ?? `HTTP ${equipa.r.status}`);

  ok((await bruto('/api/jogos/2/exportar.xlsx?equipaId=999')).status === 400, 'equipa que não joga neste jogo = 400');
  ok((await bruto('/api/jogos/99999/exportar.xlsx')).status === 404, 'jogo inexistente = 404');

  if (jogoNovo?.id) {
    const novo = await descarregar(`/api/jogos/${jogoNovo.id}/exportar.xlsx`, 'jogo-novo.xlsx');
    ok(novo.r.status === 200 && novo.bytes[0] === 0x50, 'exportar um jogo com poucos eventos também funciona', `HTTP ${novo.r.status}`);
  }
});

// ----------------------------------------------------------------------
console.log('');
fs.writeFileSync(path.join(EXCEL_DIR, 'integracao.txt'), linhas.join('\n') + '\n');
if (falhas.length) {
  console.log(`${falhas.length} verificação(ões) falharam:\n- ${falhas.join('\n- ')}`);
  // Anotação visível na página da execução do GitHub Actions
  const texto = falhas.slice(0, 25).join('%0A').replaceAll('\r', '').replaceAll('\n', '%0A');
  console.log(`::error title=Teste de integração da API::${texto}`);
  process.exit(1);
}
console.log(`Todas as ${linhas.length} verificações passaram.`);
