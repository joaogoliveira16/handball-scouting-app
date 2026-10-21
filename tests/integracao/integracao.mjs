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
const equipaPrincipal = `Principal FC ${sufixo}`;   // a equipa da conta principal (pedida no registo)
const equipaSegunda = `Segunda FC ${sufixo}`;
const URL_PUBLICO = process.env.URL_PUBLICO ?? 'http://localhost:8080';   // App__UrlPublico da API: vai nos links dos emails

// ----------------------------------------------------------------------
await passo('Contas: sem sessão, registo, entrada, saída', async () => {
  // Sem sessão: tudo o que é da conta pede entrada (401); um jogo alheio "não existe" (404)
  const protegidas = [
    ['GET', '/api/conta'], ['GET', '/api/jogos'], ['GET', '/api/equipas'], ['POST', '/api/equipas'],
    ['GET', '/api/equipas/1/jogadores'], ['GET', '/api/equipas/1/estatisticas'], ['POST', '/api/equipas/1/jogadores'], ['PUT', '/api/jogadores/4'], ['DELETE', '/api/jogadores/4'],
    ['GET', '/api/jogos/2/eventos'], ['PUT', '/api/jogos/2/eventos/1'], ['POST', '/api/jogos'], ['PUT', '/api/jogos/2'], ['PUT', '/api/jogos/2/terminado'], ['DELETE', '/api/jogos/2'], ['GET', '/api/jogos/2/convocados'], ['PUT', '/api/jogos/2/convocados'],
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
    ['nome vazio', { nome: '  ', equipa: 'Equipa', email: emailPrincipal, palavraPasse: SENHA }],
    ['nome gigante', { nome: 'x'.repeat(81), equipa: 'Equipa', email: emailPrincipal, palavraPasse: SENHA }],
    ['sem equipa', { nome: 'Ana', email: emailPrincipal, palavraPasse: SENHA }],
    ['equipa vazia', { nome: 'Ana', equipa: '   ', email: emailPrincipal, palavraPasse: SENHA }],
    ['equipa com nome gigante', { nome: 'Ana', equipa: 'x'.repeat(81), email: emailPrincipal, palavraPasse: SENHA }],
    ['email sem @', { nome: 'Ana', equipa: 'Equipa', email: 'sem-arroba', palavraPasse: SENHA }],
    ['email sem domínio', { nome: 'Ana', equipa: 'Equipa', email: 'ana@', palavraPasse: SENHA }],
    ['palavra-passe curta', { nome: 'Ana', equipa: 'Equipa', email: emailPrincipal, palavraPasse: 'curta' }],
    ['palavra-passe só com espaços', { nome: 'Ana', equipa: 'Equipa', email: emailPrincipal, palavraPasse: ' '.repeat(10) }],
    ['palavra-passe gigante', { nome: 'Ana', equipa: 'Equipa', email: emailPrincipal, palavraPasse: 'x'.repeat(129) }],
  ];
  for (const [nome, corpo] of invalidos) {
    const r = await http('POST', '/api/conta/registar', corpo, new Sessao('inválida'));
    ok(r.status === 400 && typeof r.json?.erro === 'string' && r.setCookie.length === 0, `registo recusado (400, sem cookie): ${nome}`, descricao(r));
  }

  // Registo da conta principal (email com maiúsculas: fica guardado em minúsculas). Não inicia sessão: falta confirmar o email.
  const registo = await http('POST', '/api/conta/registar', { nome: `  Principal ${sufixo} `, equipa: `  ${equipaPrincipal} `, email: emailPrincipal.toUpperCase(), palavraPasse: SENHA }, principal);
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
  const repetidoPorConfirmar = await http('POST', '/api/conta/registar', { nome: 'Outra', equipa: 'Outra FC', email: emailPrincipal, palavraPasse: 'outra-palavra-1' }, new Sessao('repetida'));
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

  const repetido = await http('POST', '/api/conta/registar', { nome: 'Outra', equipa: 'Outra FC', email: emailPrincipal, palavraPasse: SENHA }, new Sessao('repetida'));
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
  const equipasPrincipal = await http('GET', '/api/equipas');
  const propriaPrincipal = equipasPrincipal.json?.filter((e) => e.propria) ?? [];
  ok(propriaPrincipal.length === 1 && propriaPrincipal[0].nome === equipaPrincipal && propriaPrincipal[0].jogadores === 0 && equipasPrincipal.json[0].propria === true,
    'a conta tem uma só equipa sua (a do registo, sem espaços nas pontas), e vem primeiro na lista', descricao(equipasPrincipal));
  ok(['Águias do Norte', 'Leões do Sul'].every((n) => equipasPrincipal.json?.some((e) => e.nome === n && e.propria === false)),
    'as equipas de exemplo que a primeira conta herdou são adversárias (propria = false)');

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
  const registo2 = await http('POST', '/api/conta/registar', { nome: `Segunda ${sufixo}`, equipa: equipaSegunda, email: emailSegunda, palavraPasse: SENHA }, segunda);
  ok(registo2.status === 201, 'registo da segunda conta = 201', descricao(registo2));
  ok((await http('POST', '/api/conta/confirmar-email', { token: await ultimoToken(emailSegunda) }, anonima)).status === 204, 'a segunda conta confirma o email');
  const entrou2 = await http('POST', '/api/conta/entrar', { email: emailSegunda, palavraPasse: SENHA }, segunda);
  ok(entrou2.status === 200 && entrou2.json?.id !== entrouPrincipal.json?.id, 'a segunda conta entra (conta diferente da primeira)', descricao(entrou2));
  ok((await http('POST', '/api/conta/reenviar-confirmacao', { email: emailSegunda }, anonima)).status === 204, 'reenviar para uma conta já confirmada = 204');
  await esperar(300);
  ok((await mensagensPara(emailSegunda)).length === 1, 'e não envia outro email a quem já confirmou');
  const equipasSegunda = await http('GET', '/api/equipas', undefined, segunda);
  const jogosSegunda = await http('GET', '/api/jogos', undefined, segunda);
  ok(equipasSegunda.json?.length === 1 && equipasSegunda.json[0].nome === equipaSegunda && equipasSegunda.json[0].propria === true && JSON.stringify(jogosSegunda.json) === '[]',
    'a segunda conta começa só com a sua equipa e sem jogos (não herda os dados de exemplo)', `${equipasSegunda.texto} / ${jogosSegunda.texto}`);
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
  ok((await http('POST', '/api/conta/registar', { nome: `Recuperar ${sufixo}`, equipa: `Recuperar FC ${sufixo}`, email, palavraPasse: SENHA }, anonima)).status === 201, 'conta para recuperar criada');
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
  ok((await http('POST', '/api/conta/registar', { nome: 'Por Confirmar', equipa: 'Por Confirmar FC', email: emailU, palavraPasse: SENHA }, anonima)).status === 201, 'conta por confirmar criada');
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
  ok(tipos.json?.some((t) => t.codigo === 'VERMELHO' && t.eRemate === false), 'GET /api/tipos-evento inclui o vermelho direto', descricao(tipos));
  ok(['SETE_SEIS_INICIO', 'SETE_SEIS_FIM'].every((c) => tipos.json?.some((t) => t.codigo === c && t.eRemate === false)), 'GET /api/tipos-evento inclui o início e o fim do ataque 7×6', descricao(tipos));

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
  ok(est.json.remates.filter((r) => !['DEFESA', 'GOLO'].includes(r.resultado)).every((r) => r.balizaX == null && r.balizaY == null && r.balizaZona == null),
    'jogo 2: só as defesas e os golos têm local na baliza');
  const golosExemplo = est.json.remates.filter((r) => r.resultado === 'GOLO');
  ok(golosExemplo.length === 15 && golosExemplo.every((r) => r.balizaX != null && r.balizaY != null && r.balizaZona),
    `jogo 2: os 15 golos de exemplo têm local na baliza (${golosExemplo.length})`, JSON.stringify(golosExemplo[0]));
  ok(new Set(golosExemplo.map((r) => r.balizaZona)).size >= 8, 'jogo 2: os golos de exemplo cobrem pelo menos 8 zonas da baliza');
  const posicionaisExemplo = est.json.remates.filter((r) => r.situacao === 'POSICIONAL');
  const porSistemaExemplo = Object.fromEntries(['6_0', '5_1', null].map((sis) => [sis, posicionaisExemplo.filter((r) => (r.sistemaDefensivo ?? null) === sis).length]));
  ok(posicionaisExemplo.length === 30 && porSistemaExemplo['6_0'] === 18 && porSistemaExemplo['5_1'] === 8 && porSistemaExemplo.null === 4,
    `jogo 2: os remates posicionais de exemplo trazem a defesa do adversário (6:0 ${porSistemaExemplo['6_0']}, 5:1 ${porSistemaExemplo['5_1']}, sem ${porSistemaExemplo.null})`);
  ok(est.json.remates.filter((r) => r.situacao !== 'POSICIONAL').every((r) => r.sistemaDefensivo == null), 'jogo 2: o contra-ataque e os 7 metros não têm sistema defensivo');
  const zonasExemplo = new Set(defesasExemplo.map((r) => r.balizaZona));
  ok(zonasExemplo.size === 9, `jogo 2: as defesas de exemplo cobrem as 9 zonas da baliza (${zonasExemplo.size})`);
  ok(est.json?.parcial?.length === 2 && est.json.parcial.find((p) => p.equipaId === fora?.equipaId)?.golos === 3, 'parcial dos últimos 5 minutos: 3 golos da equipa de fora');
  ok(est.json?.guardaRedes?.length >= 2, 'estatísticas de guarda-redes presentes');
  ok(est.json?.outrosEventos?.length > 0, 'outros eventos (faltas, perdas...) presentes');
  ok(est.json?.sancoes?.length === 1 && est.json.sancoes[0].jogadorId === 14 && est.json.sancoes[0].doisMinutos === 1 && est.json.sancoes[0].vermelhos === 0 && est.json.sancoes[0].expulso === false,
    'sanções: o jogo de exemplo tem um jogador com um 2 minutos (ainda não expulso)', JSON.stringify(est.json?.sancoes));
  const numericaExemplo = est.json?.numerica;
  ok(numericaExemplo?.relogioUsado === true && numericaExemplo.duracaoSegundos === 120 && numericaExemplo.suspensoes?.length === 1
    && numericaExemplo.suspensoes[0].jogadorId === 14 && numericaExemplo.suspensoes[0].tipo === 'DOIS_MINUTOS' && numericaExemplo.suspensoes[0].segundoJogo === 1900,
  'superioridade: o jogo de exemplo traz o seu 2 minutos (aos 1900 s) e o relógio como usado', JSON.stringify(numericaExemplo?.suspensoes));
  ok(numericaExemplo?.seteSeis?.length === 2 && numericaExemplo.seteSeis.every((e) => e.ativo === false && e.desde == null), 'superioridade: sem 7×6 registado as duas equipas estão em «não ativo»', JSON.stringify(numericaExemplo?.seteSeis));
  ok(Array.isArray(numericaExemplo?.eficacia) && numericaExemplo.eficacia.length > 0
    && numericaExemplo.eficacia.reduce((t, e) => t + e.remates, 0) <= 33
    && numericaExemplo.eficacia.every((e) => ['SUPERIORIDADE', 'IGUALDADE', 'INFERIORIDADE', 'SETE_SEIS', 'BALIZA_VAZIA'].includes(e.situacao) && e.golos <= e.remates),
  'superioridade: a eficácia por situação cobre os remates (sem os 7 metros)', JSON.stringify(numericaExemplo?.eficacia));
  ok(est.json?.relogio?.aCorrer === false && est.json.relogio.segundo >= 1900, 'superioridade: sem relógio avisado pelo banco, o relógio é o do último evento e está parado', JSON.stringify(est.json?.relogio));
  ok(est.json?.remates?.every((r) => Number.isInteger(r.segundoJogo)), 'superioridade: cada remate do mapa traz o segundo de jogo');

  // relatório do intervalo: cada remate traz a parte, o corredor, a distância e o guarda-redes; os outros eventos vêm também por parte
  const corredoresApi = ['PONTA_ESQ', 'LATERAL_ESQ', 'CENTRAL', 'LATERAL_DIR', 'PONTA_DIR'];
  const distanciasApi = ['ATE_6M', 'DE_6_A_9M', 'LINHA_9M', 'MAIS_9M'];
  ok(est.json.remates.every((r) => [1, 2].includes(r.parte) && corredoresApi.includes(r.corredor) && distanciasApi.includes(r.distancia) && (r.guardaRedesId == null || Number.isInteger(r.guardaRedesId))),
    'intervalo: cada remate do mapa traz a parte, o corredor, a distância e o guarda-redes', JSON.stringify(est.json.remates[0]));
  ok(est.json.remates.some((r) => r.parte === 1) && est.json.remates.some((r) => r.parte === 2), 'intervalo: o jogo de exemplo tem remates nas duas partes');
  const totalPorTipo = (lista) => Object.entries(Object.groupBy(lista, (o) => o.tipo)).map(([tipo, itens]) => `${tipo}=${itens.reduce((t, o) => t + Number(o.total), 0)}`).sort().join(',');
  ok(Array.isArray(est.json.outrosEventosPorParte) && est.json.outrosEventosPorParte.every((o) => [1, 2].includes(o.parte) && Number.isInteger(o.equipaId))
    && totalPorTipo(est.json.outrosEventosPorParte) === totalPorTipo(est.json.outrosEventos),
    'intervalo: os outros eventos por parte somam os mesmos totais que os outros eventos', JSON.stringify(est.json.outrosEventosPorParte?.slice(0, 3)));

  // treinador-assistente: no jogo de exemplo o adversário marcou 4 golos seguidos depois do time-out da casa
  const assistenteExemplo = est.json?.assistente;
  const sugestaoTimeout = assistenteExemplo?.sugestoes?.find((x) => x.codigo === 'TIMEOUT');
  ok(Array.isArray(assistenteExemplo?.sugestoes) && assistenteExemplo.sugestoes.length > 0 && assistenteExemplo.sugestoes.length <= 6, 'assistente: o jogo de exemplo traz sugestões (no máximo 6)', JSON.stringify(assistenteExemplo));
  ok(sugestaoTimeout?.nivel === 'urgente' && sugestaoTimeout.equipaId === casa?.equipaId && sugestaoTimeout.detalhe.includes('4 golos seguidos') && sugestaoTimeout.detalhe.includes('parcial de 3–0'),
    'assistente: série de golos e parcial do adversário -> time-out urgente para a casa', JSON.stringify(sugestaoTimeout));
  ok(assistenteExemplo?.sugestoes?.every((x) => x.id && x.codigo && x.titulo && x.detalhe && ['urgente', 'atencao', 'sugestao', 'info'].includes(x.nivel) && !('prioridade' in x)),
    'assistente: cada sugestão traz id, regra, nível, título e detalhe (a prioridade fica no servidor)');
  ok(new Set(assistenteExemplo?.sugestoes?.map((x) => x.id)).size === assistenteExemplo?.sugestoes?.length, 'assistente: os ids das sugestões são únicos');
  const direitos = (equipaId) => assistenteExemplo?.timeouts?.find((t) => t.equipaId === equipaId);
  ok(assistenteExemplo?.timeouts?.length === 2 && direitos(casa?.equipaId)?.usados === 1 && direitos(fora?.equipaId)?.usados === 0 && direitos(fora?.equipaId)?.restantes === 2,
    'assistente: o time-out do jogo de exemplo conta para a casa (1 usado) e o adversário tem os 2 da parte', JSON.stringify(assistenteExemplo?.timeouts));

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
  // A equipa da conta vem do registo; as outras equipas da conta são adversárias
  const inicial = (await http('GET', '/api/equipas')).json ?? [];
  const nomeA = equipaPrincipal;
  const equipaA = inicial.find((e) => e.propria)?.id;
  ok(equipaA > 0, 'a conta tem a sua equipa', JSON.stringify(inicial));

  const repetida = await http('POST', '/api/equipas', { nome: nomeA });
  ok(repetida.status === 409, 'equipa com o nome da equipa da conta = 409', descricao(repetida));
  ok((await http('POST', '/api/equipas', { nome: '   ' })).status === 400, 'equipa sem nome = 400');
  ok((await http('POST', '/api/equipas', { nome: 'x'.repeat(81) })).status === 400, 'equipa com nome gigante = 400');

  const lista = await http('GET', '/api/equipas');
  const naLista = lista.json?.find((e) => e.id === equipaA);
  ok(lista.status === 200 && naLista?.nome === nomeA && naLista.jogadores === 0 && naLista.propria === true, 'GET /api/equipas inclui a equipa da conta com 0 jogadores', descricao(lista));
  ok(lista.json?.find((e) => e.id === 1)?.jogadores === 8 && lista.json.find((e) => e.id === 1).propria === false, 'as equipas de exemplo têm 8 jogadores cada e são adversárias');

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
  const extra = await http('POST', `/api/equipas/${equipaA}/jogadores`, { numero: 33, nome: 'Para apagar', posicao: 'UN' });
  ok(extra.status === 201 && (await http('GET', `/api/equipas/${equipaA}/jogadores`)).json?.find((j) => j.id === extra.json?.id)?.posicao === 'UN', 'a posição «Universal» (UN) é aceite e fica guardada', descricao(extra));
  ok((await http('DELETE', `/api/jogadores/${extra.json?.id}`)).status === 204, 'DELETE jogador sem eventos = 204');
  ok((await http('DELETE', `/api/jogadores/${extra.json?.id}`)).status === 404, 'apagar outra vez = 404');
  const comEventos = await http('DELETE', '/api/jogadores/4');
  ok(comEventos.status === 409, 'apagar jogador com eventos = 409', descricao(comEventos));
  const doExemplo = (await http('GET', '/api/equipas/1/jogadores')).json ?? [];
  ok(doExemplo.find((j) => j.id === 4)?.eventos > 0, 'o plantel de exemplo mostra os eventos de cada jogador');

  // segunda equipa com guarda-redes e remateiro, para o jogo
  const criadaB = await http('POST', '/api/equipas', { nome: `Teste B ${sufixo}` });
  const equipaB = criadaB.json?.id;
  ok(criadaB.status === 201, 'POST /api/equipas cria uma equipa adversária', descricao(criadaB));
  const depoisDeB = (await http('GET', '/api/equipas')).json ?? [];
  ok(depoisDeB.find((e) => e.id === equipaB)?.propria === false && depoisDeB.filter((e) => e.propria).map((e) => e.id).join() === String(equipaA),
    'a nova equipa é adversária: a equipa da conta continua a ser a mesma e vem primeiro', JSON.stringify(depoisDeB.map((e) => [e.id, e.propria])));
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
  for (const resultado of ['FORA', 'POSTE', 'BLOQUEADO']) {
    const r = await http('POST', `/api/jogos/${id}/eventos`, { ...remate, resultado, balizaX: 50, balizaY: 50 });
    ok(r.status === 400 && r.texto.includes('defesa ou num golo'), `baliza: um remate «${resultado}» não tem local na baliza = 400`, descricao(r));
  }
  ok((await http('POST', `/api/jogos/${id}/eventos`, { ...remate, balizaY: undefined, balizaX: 50 })).status === 400, 'baliza: golo só com o X sem o Y = 400');
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

  // local na baliza: chega ao mapa e aos últimos eventos
  const defesaMapa = ultimo.remates.find((r) => r.id === defesa.json.id);
  ok(Number(defesaMapa?.balizaX) === 83.5 && Number(defesaMapa?.balizaY) === 91.2 && defesaMapa?.balizaZona === 'BAIXO_DIR',
    'baliza: o remate recebido traz o local e a zona (baixo à direita)', JSON.stringify(defesaMapa));
  ok(ultimo.ultimosEventos.find((e) => e.id === defesa.json.id)?.balizaZona === 'BAIXO_DIR', 'baliza: os últimos eventos trazem a zona da defesa');
  const golosNoMapa = ultimo.remates.find((r) => r.resultado === 'GOLO');
  ok(golosNoMapa && golosNoMapa.balizaX == null && golosNoMapa.balizaZona == null, 'baliza: o golo registado sem local fica sem coordenadas nem zona');

  // defesa sem local (continua válida)
  const semLocal = await http('POST', `/api/jogos/${id}/eventos`, { ...remate, resultado: 'DEFESA', x: 25, y: 70, segundoJogo: 190 });
  ok(semLocal.status === 201, 'POST remate (defesa sem local na baliza)', descricao(semLocal));
  ok(await ate(() => recebidos.length >= 4), 'a defesa sem local também atualiza o dashboard');
  const semLocalMapa = recebidos.at(-1).remates.find((r) => r.id === semLocal.json.id);
  ok(semLocalMapa && semLocalMapa.balizaX == null && semLocalMapa.balizaY == null && semLocalMapa.balizaZona == null,
    'baliza: a defesa sem local fica sem coordenadas nem zona', JSON.stringify(semLocalMapa));
  ok(recebidos.at(-1).remates.filter((r) => r.balizaZona != null).length === 1, 'baliza: só uma das duas defesas tem local');

  // golo com local na baliza (onde entrou a bola): chega ao dashboard com a zona e conta no placar
  const goloBaliza = await http('POST', `/api/jogos/${id}/eventos`, { ...remate, x: 60, y: 30, segundoJogo: 195, balizaX: 12.5, balizaY: 20 });
  ok(goloBaliza.status === 201, 'POST golo com local na baliza = 201', descricao(goloBaliza));
  ok(await ate(() => recebidos.at(-1)?.remates?.some((r) => r.id === goloBaliza.json?.id)), 'baliza: o golo com local chega ao dashboard');
  const goloMapa = recebidos.at(-1).remates.find((r) => r.id === goloBaliza.json.id);
  ok(goloMapa?.resultado === 'GOLO' && Number(goloMapa.balizaX) === 12.5 && Number(goloMapa.balizaY) === 20 && goloMapa.balizaZona === 'ALTO_ESQ',
    'baliza: o golo traz o local onde entrou e a zona (alto à esquerda)', JSON.stringify(goloMapa));
  ok(recebidos.at(-1).ultimosEventos.find((e) => e.id === goloBaliza.json.id)?.balizaZona === 'ALTO_ESQ', 'baliza: os últimos eventos trazem a zona do golo');
  ok(recebidos.at(-1).equipas.find((e) => e.equipaId === casaId).golos === 2, 'baliza: o golo com local conta no placar');
  ok((await http('DELETE', `/api/jogos/${id}/eventos/${goloBaliza.json.id}`)).status === 204, 'baliza: apagar o golo com local = 204');
  ok(await ate(() => recebidos.at(-1)?.equipas?.find((e) => e.equipaId === casaId)?.golos === 1), 'baliza: depois de apagar volta a haver um só golo');

  // sistema defensivo do adversário: opcional, só num remate em ataque posicional
  ok((await http('POST', `/api/jogos/${id}/eventos`, { ...remate, resultado: 'FORA', sistemaDefensivo: 'ZONA' })).status === 400, 'sistema defensivo: um sistema desconhecido = 400');
  const semSistema = await http('POST', `/api/jogos/${id}/eventos`, { ...remate, resultado: 'FORA', situacao: 'CONTRA_ATAQUE', sistemaDefensivo: '6_0' });
  ok(semSistema.status === 400 && semSistema.texto.includes('ataque posicional'), 'sistema defensivo: no contra-ataque = 400', descricao(semSistema));
  ok((await http('POST', `/api/jogos/${id}/eventos`, { ...remate, resultado: 'FORA', situacao: 'SETE_METROS', sistemaDefensivo: '6_0' })).status === 400, 'sistema defensivo: num 7 metros = 400');
  ok((await http('POST', `/api/jogos/${id}/eventos`, { tipoEvento: 'FALTA_OFENSIVA', equipaId: casaId, jogadorId: lateralCasa, parte: 1, segundoJogo: 200, sistemaDefensivo: '6_0' })).status === 400, 'sistema defensivo: num evento que não é remate = 400');
  const comSistema = await http('POST', `/api/jogos/${id}/eventos`, { ...remate, resultado: 'FORA', segundoJogo: 205, sistemaDefensivo: '3_2_1' });
  ok(comSistema.status === 201, 'POST remate com a defesa do adversário (3:2:1) = 201', descricao(comSistema));
  ok(await ate(() => recebidos.at(-1)?.remates?.some((r) => r.id === comSistema.json?.id)), 'sistema defensivo: o remate chega ao dashboard');
  ok(recebidos.at(-1).remates.find((r) => r.id === comSistema.json.id)?.sistemaDefensivo === '3_2_1', 'sistema defensivo: o remate traz a defesa do adversário (3_2_1)');
  ok(recebidos.at(-1).remates.find((r) => r.id === golo.json.id)?.sistemaDefensivo == null, 'sistema defensivo: um remate sem defesa escolhida vem sem sistema');
  ok((await http('DELETE', `/api/jogos/${id}/eventos/${comSistema.json.id}`)).status === 204, 'sistema defensivo: apagar o remate = 204');

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

  // sanções: o 3.º 2 minutos e o vermelho direto desqualificam o jogador (os eventos dele continuam nas estatísticas)
  const { foraId: equipaFora, lateralFora: jogadorFora } = jogoNovo;
  const sancionar = (tipo, equipaId, jogadorId, segundoJogo) => http('POST', `/api/jogos/${id}/eventos`, { tipoEvento: tipo, equipaId, jogadorId, parte: 1, segundoJogo });
  const sancaoDe = async (jogadorId) => (await http('GET', `/api/jogos/${id}/estatisticas`)).json?.sancoes?.find((x) => x.jogadorId === jogadorId);
  const sancoesCriadas = [];
  for (const [vez, segundo] of [[1, 400], [2, 500]]) {
    const r = await sancionar('DOIS_MINUTOS', casaId, lateralCasa, segundo);
    ok(r.status === 201, `sanções: ${vez}.º 2 minutos = 201`, descricao(r));
    sancoesCriadas.push(r.json?.id);
    const x = await sancaoDe(lateralCasa);
    ok(x?.doisMinutos === vez && x.vermelhos === 0 && x.expulso === false, `sanções: com ${vez} 2 minutos o jogador não está expulso`, JSON.stringify(x));
  }
  const terceiro = await sancionar('DOIS_MINUTOS', casaId, lateralCasa, 600);
  ok(terceiro.status === 201, 'sanções: 3.º 2 minutos = 201', descricao(terceiro));
  sancoesCriadas.push(terceiro.json?.id);
  ok(await ate(() => recebidos.at(-1)?.sancoes?.find((x) => x.jogadorId === lateralCasa)?.expulso === true), 'sanções: o dashboard recebe o jogador expulso ao 3.º 2 minutos');
  const expulso = recebidos.at(-1).sancoes.find((x) => x.jogadorId === lateralCasa);
  ok(expulso.doisMinutos === 3 && expulso.equipaId === casaId && expulso.numero > 0 && expulso.nome, 'sanções: traz a equipa, o número, o nome e os 3 2 minutos', JSON.stringify(expulso));
  ok(recebidos.at(-1).remates.length >= 1 && recebidos.at(-1).equipas.find((e) => e.equipaId === casaId)?.remates >= 1, 'sanções: os remates do jogador expulso continuam nas estatísticas');

  const vermelho = await sancionar('VERMELHO', equipaFora, jogadorFora, 700);
  ok(vermelho.status === 201, 'sanções: vermelho direto = 201', descricao(vermelho));
  sancoesCriadas.push(vermelho.json?.id);
  const v = await sancaoDe(jogadorFora);
  ok(v?.vermelhos === 1 && v.doisMinutos === 0 && v.expulso === true && v.equipaId === equipaFora, 'sanções: o vermelho direto expulsa logo', JSON.stringify(v));
  ok((await sancionar('VERMELHO', casaId, null, 750)).status === 400, 'sanções: o vermelho direto sem jogador = 400');
  ok((await http('POST', `/api/jogos/${id}/eventos`, { tipoEvento: 'VERMELHO', equipaId: casaId, jogadorId: lateralCasa, parte: 1, segundoJogo: 800, x: 50, y: 50 })).status === 400, 'sanções: o vermelho não tem posição no campo = 400');

  // apagar os eventos devolve os jogadores ao jogo (e deixa o jogo como estava)
  for (const eventoId of sancoesCriadas) {
    ok((await http('DELETE', `/api/jogos/${id}/eventos/${eventoId}`)).status === 204, 'sanções: apagar o evento = 204');
  }
  ok((await http('GET', `/api/jogos/${id}/estatisticas`)).json?.sancoes?.length === 0, 'sanções: sem os eventos ninguém tem sanções');

  // superioridade numérica: o relógio do banco chega ao servidor; os 2 minutos, o vermelho e o 7×6 entram na conta
  const relogioDe = (corpo, sessao = principal, caminho = `/api/jogos/${id}/relogio`) => http('PUT', caminho, corpo, sessao);
  ok((await relogioDe({ segundo: 600, aCorrer: true }, anonima)).status === 401, 'relógio: sem conta = 401');
  ok((await relogioDe({ segundo: 600, aCorrer: true }, principal, '/api/jogos/99999/relogio')).status === 404, 'relógio: jogo que não existe = 404');
  for (const [corpo, quando] of [[{ segundo: -1, aCorrer: true }, 'segundo negativo'], [{ segundo: 7201, aCorrer: true }, 'mais de 2 horas'],
    [{ segundo: 10 }, 'sem aCorrer'], [{ aCorrer: true }, 'sem segundo'], [{}, 'corpo vazio']]) {
    ok((await relogioDe(corpo)).status === 400, `relógio: ${quando} = 400`);
  }

  const mensagensAntes = recebidos.length;
  const arranque = await relogioDe({ segundo: 600, aCorrer: true });
  ok(arranque.status === 204, 'relógio: o banco arranca o relógio = 204', descricao(arranque));
  ok(await ate(() => recebidos.length > mensagensAntes), 'relógio: arrancar chega ao dashboard (SignalR)');
  const comRelogio = recebidos.at(-1);
  ok(comRelogio.relogio?.aCorrer === true && comRelogio.relogio.segundo >= 600 && comRelogio.relogio.segundo < 660, 'relógio: o estado traz o relógio a andar a partir dos 600 s', JSON.stringify(comRelogio.relogio));
  // o aviso periódico (o relógio continua a andar sem saltos) não incomoda os dashboards
  const mensagensDepois = recebidos.length;
  ok((await relogioDe({ segundo: 601, aCorrer: true })).status === 204, 'relógio: aviso periódico = 204');
  await esperar(700);
  ok(recebidos.length === mensagensDepois, 'relógio: o aviso periódico sem mudanças não gera atualizações');
  const salto = await relogioDe({ segundo: 1000, aCorrer: false });
  ok(salto.status === 204 && await ate(() => recebidos.length > mensagensDepois), 'relógio: parar e saltar para os 1000 s chega ao dashboard');
  ok(recebidos.at(-1).relogio?.aCorrer === false && recebidos.at(-1).relogio.segundo === 1000, 'relógio: parado nos 1000 s', JSON.stringify(recebidos.at(-1).relogio));

  // fora com 2 minutos aos 900 s: a casa remata em superioridade aos 930 s
  const criados = [];
  const registar = async (corpo) => { const r = await http('POST', `/api/jogos/${id}/eventos`, corpo); if (r.json?.id) criados.push(r.json.id); return r; };
  ok((await registar({ tipoEvento: 'DOIS_MINUTOS', equipaId: equipaFora, jogadorId: jogadorFora, parte: 1, segundoJogo: 900 })).status === 201, 'superioridade: 2 minutos do adversário = 201');
  ok((await registar({ ...remate, segundoJogo: 930, resultado: 'GOLO' })).status === 201, 'superioridade: remate da casa durante os 2 minutos = 201');
  ok(await ate(() => recebidos.at(-1)?.numerica?.eficacia?.some((e) => e.equipaId === casaId && e.situacao === 'SUPERIORIDADE')), 'superioridade: o dashboard recebe a eficácia em superioridade');
  let n = recebidos.at(-1).numerica;
  const sup = n.eficacia.find((e) => e.equipaId === casaId && e.situacao === 'SUPERIORIDADE');
  ok(sup.remates === 1 && sup.golos === 1, 'superioridade: a casa tem 1 remate e 1 golo em superioridade', JSON.stringify(n.eficacia));
  const suspensao = n.suspensoes.find((x) => x.segundoJogo === 900);
  ok(suspensao?.equipaId === equipaFora && suspensao.jogadorId === jogadorFora && suspensao.jogadorNumero > 0 && suspensao.tipo === 'DOIS_MINUTOS' && suspensao.eventoId > 0,
    'superioridade: a sanção traz a equipa, o jogador, o número e o tipo', JSON.stringify(suspensao));
  ok(n.tempo.find((t) => t.equipaId === casaId && t.situacao === 'SUPERIORIDADE')?.segundos === 100
    && n.tempo.find((t) => t.equipaId === equipaFora && t.situacao === 'INFERIORIDADE')?.segundos === 100,
  'superioridade: 100 s em superioridade para a casa e em inferioridade para o adversário (900 a 1000 s)', JSON.stringify(n.tempo));

  // um vermelho direto também deixa a equipa 2 minutos a menos
  ok((await registar({ tipoEvento: 'VERMELHO', equipaId: casaId, jogadorId: lateralCasa, parte: 1, segundoJogo: 940 })).status === 201, 'superioridade: vermelho direto = 201');
  ok(await ate(() => recebidos.at(-1)?.numerica?.suspensoes?.some((x) => x.tipo === 'VERMELHO')), 'superioridade: o vermelho entra nas sanções');

  // 7×6: início e fim da equipa de fora, sem jogador nem coordenadas
  const inicio76 = await registar({ tipoEvento: 'SETE_SEIS_INICIO', equipaId: equipaFora, parte: 1, segundoJogo: 960 });
  ok(inicio76.status === 201, 'superioridade: início do 7×6 = 201', descricao(inicio76));
  ok(await ate(() => recebidos.at(-1)?.numerica?.seteSeis?.find((e) => e.equipaId === equipaFora)?.ativo === true), 'superioridade: o dashboard recebe o 7×6 ligado');
  ok(recebidos.at(-1).numerica.seteSeis.find((e) => e.equipaId === equipaFora).desde === 960, 'superioridade: o 7×6 traz o segundo em que começou');
  ok((await registar({ ...remate, segundoJogo: 970, resultado: 'GOLO' })).status === 201, 'superioridade: remate da casa durante o 7×6 do adversário = 201');
  ok(await ate(() => recebidos.at(-1)?.numerica?.eficacia?.some((e) => e.equipaId === casaId && e.situacao === 'BALIZA_VAZIA')), 'superioridade: o remate contra a baliza vazia entra na conta');
  ok((await registar({ ...remate, segundoJogo: 975, resultado: 'GOLO', situacao: 'SETE_METROS' })).status === 201, 'superioridade: 7 metros = 201');
  const fim76 = await registar({ tipoEvento: 'SETE_SEIS_FIM', equipaId: equipaFora, parte: 1, segundoJogo: 990 });
  ok(fim76.status === 201, 'superioridade: fim do 7×6 = 201', descricao(fim76));
  ok(await ate(() => recebidos.at(-1)?.numerica?.seteSeis?.find((e) => e.equipaId === equipaFora)?.ativo === false), 'superioridade: o dashboard recebe o 7×6 desligado');
  n = recebidos.at(-1).numerica;
  ok(!n.eficacia.some((e) => e.situacao === 'BALIZA_VAZIA' && e.remates !== 1), 'superioridade: o 7 metros não conta (só o remate das 970 s está contra a baliza vazia)', JSON.stringify(n.eficacia));
  ok(n.tempo.find((t) => t.equipaId === equipaFora && t.situacao === 'SETE_SEIS')?.segundos === 30, 'superioridade: o 7×6 durou 30 s (960 a 990 s)', JSON.stringify(n.tempo));
  ok(recebidos.at(-1).outrosEventos.every((o) => !String(o.tipo).startsWith('SETE_SEIS')), 'superioridade: o 7×6 não conta em «outros eventos»');
  ok((await http('POST', `/api/jogos/${id}/eventos`, { tipoEvento: 'SETE_SEIS_INICIO', equipaId: casaId, parte: 1, segundoJogo: 1, x: 50, y: 50 })).status === 400, 'superioridade: o 7×6 não leva coordenadas = 400');
  ok((await http('POST', `/api/jogos/${id}/eventos`, { tipoEvento: 'SETE_SEIS_INICIO', equipaId: 999999, parte: 1, segundoJogo: 1 })).status === 400, 'superioridade: o 7×6 de uma equipa que não é do jogo = 400');

  // treinador-assistente: 4 golos seguidos do adversário -> time-out; o time-out pedido tira a sugestão e gasta direitos
  const golosFora = [1010, 1020, 1030, 1040];
  for (const [i, segundoJogo] of golosFora.entries()) {
    const r = await registar({ ...remate, equipaId: equipaFora, jogadorId: jogadorFora, guardaRedesId: null, segundoJogo, y: 25 + i });
    ok(r.status === 201, `assistente: golo ${i + 1} de 4 do adversário = 201`, descricao(r));
  }
  const sugestaoDe = (codigo) => recebidos.at(-1)?.assistente?.sugestoes?.find((x) => x.codigo === codigo);
  ok(await ate(() => sugestaoDe('TIMEOUT')?.equipaId === casaId), 'assistente: o dashboard recebe a sugestão de time-out para a equipa que sofre');
  ok(sugestaoDe('TIMEOUT').nivel === 'urgente' && sugestaoDe('TIMEOUT').detalhe.includes('4 golos seguidos') && sugestaoDe('TIMEOUT').detalhe.includes('Restam 2 time-outs'),
    'assistente: a sugestão diz porquê e quantos time-outs restam', JSON.stringify(sugestaoDe('TIMEOUT')));
  ok(sugestaoDe('MARCAR_JOGADOR')?.equipaId === casaId && sugestaoDe('MARCAR_JOGADOR').detalhe.includes('4 golos em 4 remates (100%)'),
    'assistente: o jogador do adversário que marcou sempre é para marcar de perto', JSON.stringify(sugestaoDe('MARCAR_JOGADOR')));
  ok(recebidos.at(-1).assistente.sugestoes[0].codigo === 'TIMEOUT', 'assistente: o time-out é a primeira sugestão');

  const pedirTimeout = (segundoJogo) => registar({ tipoEvento: 'TIMEOUT', equipaId: casaId, parte: 1, segundoJogo });
  const direitosDaCasa = () => recebidos.at(-1)?.assistente?.timeouts?.find((t) => t.equipaId === casaId);
  ok((await pedirTimeout(1050)).status === 201, 'assistente: a casa pede time-out = 201');
  ok(await ate(() => direitosDaCasa()?.usados === 1 && !sugestaoDe('TIMEOUT')), 'assistente: depois do time-out a sugestão desaparece e conta 1 usado');
  ok(direitosDaCasa().naParte === 1 && direitosDaCasa().restantes === 1, 'assistente: um time-out na 1.ª parte deixa mais 1 para pedir', JSON.stringify(direitosDaCasa()));
  ok((await pedirTimeout(1060)).status === 201, 'assistente: a casa pede o 2.º time-out = 201');
  ok(await ate(() => direitosDaCasa()?.usados === 2 && direitosDaCasa().restantes === 0), 'assistente: dois time-outs na parte esgotam os da 1.ª parte', JSON.stringify(direitosDaCasa()));
  // na 2.ª parte (o relógio do banco passa dos 30:00) volta a haver direito a um, porque no jogo são 3
  ok((await relogioDe({ segundo: 1900, aCorrer: false })).status === 204, 'assistente: o relógio passa para a 2.ª parte = 204');
  ok(await ate(() => direitosDaCasa()?.restantes === 1 && direitosDaCasa().naParte === 0), 'assistente: na 2.ª parte a casa ainda pode pedir 1 time-out', JSON.stringify(direitosDaCasa()));
  ok((await relogioDe({ segundo: 1000, aCorrer: false })).status === 204, 'assistente: o relógio volta aos 1000 s = 204');

  // limpar (deixa o jogo como estava) e confirmar que o relógio é do jogo
  for (const eventoId of criados) ok((await http('DELETE', `/api/jogos/${id}/eventos/${eventoId}`)).status === 204, 'superioridade: apagar o evento = 204');
  ok(await ate(() => recebidos.at(-1)?.numerica?.suspensoes?.length === 0), 'superioridade: sem os eventos já não há sanções');

  await ligacao.stop();
  ok(true, 'ligações fechadas');
});

// ----------------------------------------------------------------------
// Sem rede no pavilhão: o banco guarda os eventos no tablet e envia-os quando a rede volta. Cada evento leva um
// identificador gerado no tablet (clienteId); se o envio se repetir (a resposta perdeu-se) o servidor não regista outra vez.
await passo('Sem rede: eventos com clienteId não se registam duas vezes', async () => {
  if (!jogoNovo?.id) return ok(false, 'sem jogo do passo anterior');
  const { id, casaId, lateralCasa, grFora } = jogoNovo;
  const remate = { tipoEvento: 'REMATE', equipaId: casaId, jogadorId: lateralCasa, guardaRedesId: grFora, resultado: 'GOLO', situacao: 'POSICIONAL', x: 40, y: 30, parte: 1, segundoJogo: 330 };
  const criados = [];

  const recebidos = [];
  const ligacao = ligarHub(principal);
  ligacao.on('EstatisticasAtualizadas', (estado) => recebidos.push(estado));
  await ligacao.start();
  await ligacao.invoke('EntrarNoJogo', id, null);

  const ultimos = async () => (await http('GET', `/api/jogos/${id}/estatisticas`)).json.ultimosEventos;
  const doCliente = async (clienteId) => (await ultimos()).filter((e) => e.clienteId === clienteId);

  // O 1.º envio regista o evento com a hora a que o adjunto o registou (5 minutos atrás, por exemplo)
  const clienteId = crypto.randomUUID();
  const ocorridoEm = new Date(Date.now() - 5 * 60 * 1000);
  const corpo = { ...remate, clienteId, ocorridoEm: ocorridoEm.toISOString() };
  const primeiro = await http('POST', `/api/jogos/${id}/eventos`, corpo);
  ok(primeiro.status === 201 && primeiro.json?.id > 0 && primeiro.json.repetido !== true, 'clienteId: o 1.º envio regista o evento = 201', descricao(primeiro));
  criados.push(primeiro.json?.id);
  const registado = (await doCliente(clienteId))[0];
  ok(registado?.id === primeiro.json.id, 'clienteId: os últimos eventos trazem o clienteId do banco', JSON.stringify(registado));
  ok(registado && Math.abs(new Date(registado.criadoEm) - ocorridoEm) < 1000, `clienteId: o evento fica com a hora do tablet (ocorridoEm), não a do envio (${registado?.criadoEm})`);

  // O mesmo envio outra vez: 200 com o mesmo id, sem evento novo; o dashboard recebe o estado na mesma
  const antes = recebidos.length;
  const repetido = await http('POST', `/api/jogos/${id}/eventos`, corpo);
  ok(repetido.status === 200 && repetido.json?.repetido === true && repetido.json.id === primeiro.json.id, 'clienteId: reenviar o mesmo evento = 200 «repetido» com o mesmo id', descricao(repetido));
  ok((await doCliente(clienteId)).length === 1, 'clienteId: continua a existir um só evento');
  ok(await ate(() => recebidos.length > antes), 'clienteId: o reenvio também atualiza o dashboard (o primeiro aviso pode ter-se perdido)');
  const golosAntes = recebidos.at(-1).equipas.find((e) => e.equipaId === casaId).golos;
  await http('POST', `/api/jogos/${id}/eventos`, corpo);
  await esperar(300);
  ok(recebidos.at(-1).equipas.find((e) => e.equipaId === casaId).golos === golosAntes, 'clienteId: reenviar mais vezes não muda o placar');

  // O identificador é que manda: o mesmo clienteId com outro conteúdo também não regista nada
  const outroConteudo = await http('POST', `/api/jogos/${id}/eventos`, { ...corpo, resultado: 'DEFESA', x: 20, y: 60 });
  ok(outroConteudo.status === 200 && outroConteudo.json?.repetido === true && outroConteudo.json.id === primeiro.json.id, 'clienteId: o mesmo identificador com outro conteúdo também é repetido');
  ok((await doCliente(clienteId))[0].resultado === 'GOLO', 'clienteId: o evento original não é alterado pelo reenvio');

  // Outro identificador é outro evento
  const segundoCliente = crypto.randomUUID();
  const segundo = await http('POST', `/api/jogos/${id}/eventos`, { ...remate, clienteId: segundoCliente });
  ok(segundo.status === 201 && segundo.json.id !== primeiro.json.id, 'clienteId: outro identificador = outro evento = 201', descricao(segundo));
  criados.push(segundo.json?.id);

  // Clientes sem identificador (outras versões) continuam a funcionar e cada envio é um evento
  const semA = await http('POST', `/api/jogos/${id}/eventos`, remate);
  const semB = await http('POST', `/api/jogos/${id}/eventos`, remate);
  ok(semA.status === 201 && semB.status === 201 && semA.json.id !== semB.json.id, 'sem clienteId: cada envio regista um evento (como antes)', descricao(semB));
  criados.push(semA.json?.id, semB.json?.id);
  ok((await ultimos()).find((e) => e.id === semA.json.id)?.clienteId == null, 'sem clienteId: o evento fica sem identificador');

  // Identificador inválido
  const zeros = await http('POST', `/api/jogos/${id}/eventos`, { ...remate, clienteId: '00000000-0000-0000-0000-000000000000' });
  ok(zeros.status === 400 && zeros.texto.includes('clienteId'), 'clienteId: o identificador de zeros = 400', descricao(zeros));
  ok((await http('POST', `/api/jogos/${id}/eventos`, { ...remate, clienteId: 'isto-nao-e-um-uuid' })).status === 400, 'clienteId: texto que não é um UUID = 400');
  ok((await http('POST', `/api/jogos/${id}/eventos`, { ...remate, ocorridoEm: 'ontem' })).status === 400, 'ocorridoEm: texto que não é uma data = 400');

  // O relógio do tablet não é de confiança: nunca no futuro, e um evento muito antigo leva a hora do envio
  const noFuturo = await http('POST', `/api/jogos/${id}/eventos`, { ...remate, clienteId: crypto.randomUUID(), ocorridoEm: new Date(Date.now() + 3600 * 1000).toISOString() });
  const muitoAntigo = await http('POST', `/api/jogos/${id}/eventos`, { ...remate, clienteId: crypto.randomUUID(), ocorridoEm: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString() });
  criados.push(noFuturo.json?.id, muitoAntigo.json?.id);
  const hora = async (eventoId) => new Date((await ultimos()).find((e) => e.id === eventoId)?.criadoEm).getTime();
  ok(Math.abs((await hora(noFuturo.json.id)) - Date.now()) < 10000, 'ocorridoEm: um tablet adiantado não regista eventos no futuro');
  ok(Math.abs((await hora(muitoAntigo.json.id)) - Date.now()) < 10000, 'ocorridoEm: um evento com mais de 12 horas leva a hora do envio');

  // Dois envios ao mesmo tempo do mesmo evento (a lista de jogos e o banco abertos juntos): um só evento
  const simultaneo = { ...remate, clienteId: crypto.randomUUID() };
  const respostas = await Promise.all(Array.from({ length: 4 }, () => http('POST', `/api/jogos/${id}/eventos`, simultaneo)));
  ok(respostas.every((r) => r.status === 201 || r.status === 200), 'clienteId: envios simultâneos do mesmo evento não dão erro', respostas.map((r) => r.status).join(','));
  ok(respostas.filter((r) => r.status === 201).length === 1 && new Set(respostas.map((r) => r.json?.id)).size === 1, 'clienteId: envios simultâneos criam um só evento (um 201, os outros «repetido»)', respostas.map((r) => `${r.status}:${r.json?.id}`).join(' '));
  criados.push(respostas[0].json?.id);
  ok((await doCliente(simultaneo.clienteId)).length === 1, 'clienteId: só existe um evento depois dos envios simultâneos');

  // Sem sessão não se regista nada, com ou sem clienteId
  ok((await http('POST', `/api/jogos/${id}/eventos`, { ...corpo, clienteId: crypto.randomUUID() }, anonima)).status === 401, 'clienteId: sem sessão = 401');

  for (const eventoId of criados.filter(Boolean)) await http('DELETE', `/api/jogos/${id}/eventos/${eventoId}`);
  ok((await ultimos()).every((e) => !criados.includes(e.id)), 'clienteId: eventos de teste apagados');
  await ligacao.stop();
});

function lateralFora(j) { return j.lateralFora; }

// ----------------------------------------------------------------------
// Um jogo está aberto a convidados durante 24 horas: a partir do último evento ou, sem eventos, da hora do jogo.
// O jogo do passo anterior acabou de receber eventos. (Os jogos 1 e 2 dos dados de exemplo são de há 3 dias.)
// No fim os jogos criados aqui ficam escondidos, para os passos de privacidade que se seguem.
await passo('Estatísticas dos jogadores da equipa (uma linha por jogador e jogo)', async () => {
  if (!jogoNovo) return ok(false, 'sem equipas do passo "Equipas e jogadores"');
  const { casaId, foraId, grCasa, lateralCasa, lateralFora } = jogoNovo;   // a equipa da conta (casa), um adversário e os seus jogadores
  const caminho = `/api/equipas/${casaId}/estatisticas`;
  const novo = await http('POST', '/api/jogos', { casaId, foraId, dataHora: '2026-10-03T18:00:00Z' });
  const vazio = await http('POST', '/api/jogos', { casaId, foraId, dataHora: '2026-10-04T18:00:00Z' });   // sem eventos: não conta
  const jogoId = novo.json?.id;
  const evento = (corpo) => http('POST', `/api/jogos/${jogoId}/eventos`, { parte: 1, segundoJogo: 60, ...corpo });
  const remate = (equipaId, jogadorId, resultado, extra = {}) => evento({ tipoEvento: 'REMATE', equipaId, jogadorId, resultado, situacao: 'POSICIONAL', x: 50, y: 25, ...extra });
  const registos = [
    ...['GOLO', 'GOLO', 'FORA'].map((r) => remate(casaId, lateralCasa, r)),
    remate(casaId, lateralCasa, 'GOLO', { situacao: 'SETE_METROS' }),
    evento({ tipoEvento: 'PERDA_BOLA', equipaId: casaId, jogadorId: lateralCasa }),
    ...['DEFESA', 'DEFESA', 'GOLO'].map((r) => remate(foraId, lateralFora, r, { guardaRedesId: grCasa })),
  ];
  const respostas = [];
  for (const r of registos) respostas.push((await r).status);   // um de cada vez, na ordem
  ok(novo.status === 201 && vazio.status === 201 && respostas.every((e) => e === 201), 'estatísticas: jogo com remates, 7 metros, uma perda de bola e remates contra o guarda-redes registados', respostas.join());

  const r = await http('GET', caminho);
  ok(r.status === 200 && r.json?.equipaId === casaId && Array.isArray(r.json?.plantel) && Array.isArray(r.json?.jogos) && Array.isArray(r.json?.linhas),
    'GET /api/equipas/{id}/estatisticas = 200 com plantel, jogos e linhas', descricao(r));
  const jogador = r.json?.plantel?.find((j) => j.id === lateralCasa);
  ok(jogador?.numero === 10 && jogador.nome === 'Tiago Editado' && jogador.posicao === 'LD', 'o plantel traz o número, o nome e a posição', JSON.stringify(jogador));
  const jogo = r.json?.jogos?.find((j) => j.jogoId === jogoId);
  ok(jogo && jogo.golos === 3 && jogo.golosAdversario === 1 && jogo.emCasa === true && jogo.adversarioId === foraId && new Date(jogo.dataHora).toISOString() === '2026-10-03T18:00:00.000Z',
    'o jogo traz o resultado (3–1), o adversário, em casa e a data', JSON.stringify(jogo));
  ok(!r.json?.jogos?.some((j) => j.jogoId === vazio.json?.id), 'um jogo sem eventos não conta');
  ok(!r.json?.jogos?.some((j) => j.jogoId === 2) && !r.json?.linhas?.some((l) => l.jogoId === 2), 'os jogos de outras equipas (o jogo de exemplo) não entram');
  const datas = (r.json?.jogos ?? []).map((j) => Date.parse(j.dataHora));
  ok(datas.every((d, i) => i === 0 || d >= datas[i - 1]), 'os jogos vêm do mais antigo para o mais recente');

  const linhaDe = (id) => r.json?.linhas?.find((l) => l.jogoId === jogoId && l.jogadorId === id);
  const l = linhaDe(lateralCasa);
  ok(l && l.remates === 4 && l.golos === 3 && l.fora === 1 && l.defendidos === 0 && l.seteMetros === 1 && l.golosSeteMetros === 1 && l.perdasBola === 1 && l.defesas === 0,
    'o lateral: 4 remates (3 golos, 1 fora), 1 sete metros marcado e 1 perda de bola', JSON.stringify(l));
  const g = linhaDe(grCasa);
  ok(g && g.defesas === 2 && g.golosSofridos === 1 && g.seteMetrosSofridos === 0 && g.remates === 0, 'o guarda-redes: 2 defesas e 1 golo sofrido (os remates contra ele)', JSON.stringify(g));
  ok(r.json?.linhas?.filter((x) => x.jogoId === jogoId).length === 2, 'só têm linha neste jogo quem jogou (o lateral e o guarda-redes)');
  ok(r.json?.linhas?.every((x) => r.json.plantel.some((j) => j.id === x.jogadorId) && r.json.jogos.some((j) => j.jogoId === x.jogoId)), 'todas as linhas são de jogadores do plantel e de jogos da lista');

  // Convocado sem eventos também entra no jogo
  const convocados = [grCasa, lateralCasa, (r.json.plantel.find((j) => j.id !== grCasa && j.id !== lateralCasa))?.id];
  ok((await http('PUT', `/api/jogos/${jogoId}/convocados`, { jogadorIds: convocados.filter(Boolean) })).status === 204, 'convocar mais um jogador');
  const comConvocado = await http('GET', caminho);
  const convocadoSemEventos = comConvocado.json?.linhas?.find((x) => x.jogoId === jogoId && x.jogadorId === convocados[2]);
  ok(convocadoSemEventos && convocadoSemEventos.remates === 0 && convocadoSemEventos.golos === 0, 'um convocado sem eventos tem uma linha com zeros (jogou o jogo)', JSON.stringify(convocadoSemEventos));
  await http('PUT', `/api/jogos/${jogoId}/convocados`, { jogadorIds: [] });

  // Só uma parte: ?parte=1|2 conta só o que aconteceu nessa parte (golos do jogo e números dos jogadores)
  const segundaParte = await remate(casaId, lateralCasa, 'GOLO', { parte: 2, segundoJogo: 2500 });
  ok(segundaParte.status === 201, 'estatísticas: um golo da casa na 2.ª parte registado', descricao(segundaParte));
  const todo = await http('GET', caminho);
  const parte1 = await http('GET', `${caminho}?parte=1`);
  const parte2 = await http('GET', `${caminho}?parte=2`);
  const deste = (resposta) => resposta.json?.jogos?.find((j) => j.jogoId === jogoId);
  const linhaNeste = (resposta, id) => resposta.json?.linhas?.find((x) => x.jogoId === jogoId && x.jogadorId === id);
  ok(todo.status === 200 && deste(todo)?.golos === 4 && deste(todo)?.golosAdversario === 1 && linhaNeste(todo, lateralCasa)?.remates === 5,
    'sem ?parte: o jogo todo (4–1, o lateral com 5 remates)', JSON.stringify(deste(todo)));
  ok(parte1.status === 200 && deste(parte1)?.golos === 3 && deste(parte1)?.golosAdversario === 1 && linhaNeste(parte1, lateralCasa)?.remates === 4 && linhaNeste(parte1, grCasa)?.defesas === 2,
    '?parte=1: só a 1.ª parte (3–1, o lateral com 4 remates, o guarda-redes com as 2 defesas)', JSON.stringify(deste(parte1)));
  ok(parte2.status === 200 && deste(parte2)?.golos === 1 && deste(parte2)?.golosAdversario === 0 && linhaNeste(parte2, lateralCasa)?.remates === 1 && linhaNeste(parte2, lateralCasa)?.perdasBola === 0 && !linhaNeste(parte2, grCasa),
    '?parte=2: só a 2.ª parte (1–0, o lateral com 1 remate e sem a perda de bola; quem não fez nada nessa parte não tem linha)', JSON.stringify(deste(parte2)));
  ok(parte2.json?.plantel?.length === todo.json?.plantel?.length && parte2.json?.jogos?.every((j) => todo.json.jogos.some((t) => t.jogoId === j.jogoId)),
    '?parte=2: o plantel é o mesmo e os jogos são alguns dos do jogo todo (só os que têm eventos nessa parte)');
  // Um jogo só com a 1.ª parte registada: entra no jogo todo e na 1.ª parte, mas não na 2.ª (não seria um 0–0, seria um jogo sem registo)
  const soPrimeira = await http('POST', '/api/jogos', { casaId, foraId, dataHora: '2026-10-05T18:00:00Z' });
  const idSoPrimeira = soPrimeira.json?.id;
  await http('POST', `/api/jogos/${idSoPrimeira}/eventos`, { tipoEvento: 'REMATE', equipaId: casaId, jogadorId: lateralCasa, resultado: 'GOLO', situacao: 'POSICIONAL', x: 50, y: 25, parte: 1, segundoJogo: 90 });
  const estaEm = async (sufixoPedido) => (await http('GET', `${caminho}${sufixoPedido}`)).json?.jogos?.some((j) => j.jogoId === idSoPrimeira);
  ok(await estaEm('') && await estaEm('?parte=1') && !(await estaEm('?parte=2')), 'um jogo só com a 1.ª parte registada está no jogo todo e na 1.ª parte, mas não na 2.ª');
  ok(!(await http('GET', `${caminho}?parte=2`)).json?.linhas?.some((x) => x.jogoId === idSoPrimeira), 'e também não tem linhas de jogadores na 2.ª parte');
  await http('DELETE', `/api/jogos/${idSoPrimeira}`);
  for (const mau of ['0', '3', '-1', 'x']) {
    const recusa = await http('GET', `${caminho}?parte=${mau}`);
    // um número fora de 1 e 2 leva a explicação; o que nem é número recusa-o o próprio ASP.NET (400 sem corpo)
    ok(recusa.status === 400 && (mau === 'x' || /parte/.test(recusa.json?.erro ?? '')), `?parte=${mau} = 400`, descricao(recusa));
  }
  ok((await http('GET', `/api/equipas/99999/estatisticas?parte=1`)).status === 404 && (await http('GET', `${caminho}?parte=1`, undefined, segunda)).status === 404 && (await http('GET', `${caminho}?parte=1`, undefined, anonima)).status === 401,
    '?parte=1 respeita o dono: equipa que não existe 404, outra conta 404, sem sessão 401');
  ok((await http('DELETE', `/api/jogos/${jogoId}/eventos/${segundaParte.json?.id}`)).status === 204, 'e o golo da 2.ª parte apaga-se (os passos seguintes ficam como estavam)');

  // Só a dona da equipa lê: outra conta, sem sessão e uma equipa que não existe
  ok((await http('GET', caminho, undefined, segunda)).status === 404, 'outra conta não lê as estatísticas da equipa (404)');
  ok((await http('GET', caminho, undefined, anonima)).status === 401, 'sem sessão = 401');
  ok((await http('GET', '/api/equipas/99999/estatisticas')).status === 404, 'equipa que não existe = 404');
  const propriaSegunda = (await http('GET', '/api/equipas', undefined, segunda)).json?.find((e) => e.propria)?.id;
  const daSegunda = await http('GET', `/api/equipas/${propriaSegunda}/estatisticas`, undefined, segunda);
  ok(daSegunda.status === 200 && daSegunda.json?.jogos?.length === 0 && daSegunda.json?.linhas?.length === 0 && daSegunda.json?.plantel?.length === 0, 'a equipa da segunda conta (sem jogos nem jogadores) = 200 com listas vazias', descricao(daSegunda));
  ok((await http('GET', `/api/equipas/${propriaSegunda}/estatisticas`)).status === 404, 'e a primeira conta não a lê (404)');
});

// ----------------------------------------------------------------------
await passo('Corrigir, terminar e apagar um jogo', async () => {
  if (!jogoNovo) return ok(false, 'sem equipas do passo "Equipas e jogadores"');
  const { casaId, foraId, lateralCasa, grFora } = jogoNovo;
  const criado = await http('POST', '/api/jogos', { casaId, foraId, local: 'Pavilhão 1', dataHora: '2026-10-20T18:00:00Z' });
  const id = criado.json?.id;
  const caminho = `/api/jogos/${id}`;
  const ver = async () => (await http('GET', caminho)).json;
  const propriaSegunda = (await http('GET', '/api/equipas', undefined, segunda)).json?.find((e) => e.propria)?.id;
  ok(criado.status === 201 && (await ver())?.terminadoEm === null, 'jogo novo: ainda não está terminado', descricao(criado));

  // Corrigir: data, local, e trocar a casa com a de fora
  const igual = { casaId, foraId, local: ' Pavilhão 2 ', dataHora: '2026-10-21T19:30:00+01:00' };
  ok((await http('PUT', caminho, igual)).status === 204, 'PUT jogo (data e local) = 204');
  let jogo = await ver();
  ok(jogo?.local === 'Pavilhão 2' && new Date(jogo.dataHora).toISOString() === '2026-10-21T18:30:00.000Z', 'o local sai sem espaços e a data converte-se para UTC', JSON.stringify(jogo));
  ok((await http('PUT', caminho, { casaId, foraId, local: null, dataHora: null })).status === 204, 'PUT sem data nem local = 204');
  jogo = await ver();
  ok(jogo?.local === null && new Date(jogo.dataHora).toISOString() === '2026-10-21T18:30:00.000Z', 'sem local fica sem local; sem data fica a que estava', JSON.stringify(jogo));
  ok((await http('PUT', caminho, { casaId: foraId, foraId: casaId })).status === 204 && (await ver())?.casaId === foraId, 'trocar a casa com a de fora = 204');
  ok((await http('PUT', caminho, { casaId, foraId: casaId })).status === 400, 'a mesma equipa nos dois lados = 400');
  ok((await http('PUT', caminho, { casaId, foraId, local: 'x'.repeat(121) })).status === 400, 'local gigante = 400');
  ok((await http('PUT', caminho, { casaId, foraId: 99999 })).status === 400, 'equipa que não existe = 400');
  ok((await http('PUT', caminho, { casaId, foraId: propriaSegunda })).status === 400, 'equipa de outra conta = 400');
  ok((await http('PUT', '/api/jogos/99999', igual)).status === 404, 'corrigir um jogo que não existe = 404');
  ok((await http('PUT', caminho, igual, segunda)).status === 404, 'outra conta não corrige o jogo (404)');

  // Mudar de adversário: só sem eventos (e leva a convocatória do que saiu)
  const outra = (await http('POST', '/api/equipas', { nome: `Teste C ${sufixo}` })).json?.id;
  const jogadorC = (await http('POST', `/api/equipas/${outra}/jogadores`, { numero: 5, nome: 'C Cinco', posicao: 'PV' })).json?.id;
  ok((await http('PUT', `${caminho}/convocados`, { jogadorIds: [lateralCasa, grFora] })).status === 204, 'convocar um jogador de cada equipa');
  ok((await http('PUT', caminho, { casaId, foraId: outra })).status === 204 && (await ver())?.foraId === outra, 'sem eventos muda-se de adversário = 204');
  ok(JSON.stringify((await http('GET', `${caminho}/convocados`)).json?.jogadorIds) === JSON.stringify([lateralCasa]), 'e saem da convocatória os jogadores do adversário que saiu');
  ok((await http('POST', `${caminho}/eventos`, { tipoEvento: 'REMATE', equipaId: casaId, jogadorId: lateralCasa, resultado: 'GOLO', situacao: 'POSICIONAL', x: 50, y: 25, parte: 1, segundoJogo: 30 })).status === 201, 'um golo registado');
  const mudar = await http('PUT', caminho, { casaId, foraId });
  ok(mudar.status === 409 && /eventos/.test(mudar.texto) && (await ver())?.foraId === outra, 'com eventos não se muda de adversário (409, nada muda)', descricao(mudar));
  ok((await http('PUT', caminho, { casaId: outra, foraId: casaId })).status === 204, 'com eventos dá para trocar a casa com a de fora');
  ok((await http('GET', '/api/jogos')).json?.find((j) => j.id === id)?.golosFora === 1, 'e o golo continua a ser da mesma equipa (agora a de fora)');

  // Terminar e reabrir
  ok((await http('PUT', `${caminho}/terminado`, {})).status === 400, 'terminado é obrigatório = 400');
  ok((await http('PUT', '/api/jogos/99999/terminado', { terminado: true })).status === 404, 'terminar um jogo que não existe = 404');
  ok((await http('PUT', `${caminho}/terminado`, { terminado: true }, segunda)).status === 404, 'outra conta não termina o jogo (404)');
  ok((await http('PUT', `${caminho}/terminado`, { terminado: true })).status === 204, 'PUT terminado = 204');
  const fim = (await ver())?.terminadoEm;
  ok(fim && Math.abs(Date.now() - Date.parse(fim)) < 5 * 60 * 1000, 'o detalhe do jogo diz quando terminou', String(fim));
  ok((await http('GET', '/api/jogos')).json?.find((j) => j.id === id)?.terminadoEm === fim, 'a lista de jogos também');
  ok((await http('GET', `${caminho}/estatisticas`)).json?.terminadoEm === fim, 'e o estado que o dashboard recebe');
  ok((await http('PUT', `${caminho}/terminado`, { terminado: true })).status === 204 && (await ver())?.terminadoEm === fim, 'terminar outra vez não muda a hora do fim');
  ok((await http('PUT', `${caminho}/terminado`, { terminado: false })).status === 204 && (await ver())?.terminadoEm === null && (await http('GET', `${caminho}/estatisticas`)).json?.terminadoEm === null, 'reabrir = 204 e o jogo deixa de estar terminado');

  // Apagar: leva os eventos e a convocatória
  ok((await http('DELETE', caminho, undefined, segunda)).status === 404 && (await ver())?.id === id, 'outra conta não apaga o jogo (404)');
  ok((await http('DELETE', caminho)).status === 204, 'DELETE jogo = 204');
  ok((await http('GET', caminho)).status === 404 && (await http('GET', `${caminho}/estatisticas`)).status === 404, 'o jogo apagado já não existe');
  ok(!(await http('GET', '/api/jogos')).json?.some((j) => j.id === id), 'e sai da lista de jogos');
  ok((await http('DELETE', caminho)).status === 404, 'apagar outra vez = 404');
  ok((await http('GET', '/api/jogos')).json?.some((j) => j.id === 2), 'os outros jogos ficam como estavam');
  ok((await http('GET', `/api/equipas/${outra}/jogadores`)).json?.some((j) => j.id === jogadorC), 'e as equipas e os jogadores também (só o jogo se apaga)');
});

// ----------------------------------------------------------------------
await passo('Corrigir eventos: ver todos, corrigir e apagar', async () => {
  if (!jogoNovo) return ok(false, 'sem equipas do passo "Equipas e jogadores"');
  const { casaId, foraId, grCasa, lateralCasa, grFora, lateralFora } = jogoNovo;
  const id = (await http('POST', '/api/jogos', { casaId, foraId })).json?.id;
  const eventos = `/api/jogos/${id}/eventos`;
  const remate = { tipoEvento: 'REMATE', equipaId: casaId, jogadorId: lateralCasa, guardaRedesId: grFora, resultado: 'FORA', situacao: 'POSICIONAL', x: 50, y: 40, parte: 1, segundoJogo: 120 };
  const doisMin = { tipoEvento: 'DOIS_MINUTOS', equipaId: foraId, jogadorId: lateralFora, parte: 2, segundoJogo: 2100 };
  const idRemate = (await http('POST', eventos, { ...remate, clienteId: crypto.randomUUID() })).json?.id;
  const idDois = (await http('POST', eventos, doisMin)).json?.id;
  const verTodos = async (sessao = principal) => (await http('GET', eventos, undefined, sessao)).json;
  const evento = async (eventoId) => (await verTodos()).find((e) => e.id === eventoId);
  const golos = async (equipaId) => (await http('GET', `/api/jogos/${id}/estatisticas`)).json?.equipas?.find((e) => e.equipaId === equipaId)?.golos;

  // Listar: tudo o que é preciso para corrigir, pela ordem do jogo
  const todos = await verTodos();
  ok(Array.isArray(todos) && todos.map((e) => e.id).join() === [idRemate, idDois].join(), 'GET eventos: todos os eventos do jogo, por parte e minuto', JSON.stringify(todos)?.slice(0, 200));
  const r = todos?.[0];
  ok(r?.tipoEvento === 'REMATE' && r.eRemate === true && r.equipaId === casaId && r.jogadorId === lateralCasa && r.jogadorNumero > 0 && !!r.jogadorNome
    && r.guardaRedesId === grFora && r.guardaRedesNumero > 0 && r.resultado === 'FORA' && r.situacao === 'POSICIONAL' && Number(r.x) === 50 && Number(r.y) === 40 && r.parte === 1 && r.segundoJogo === 120,
  'cada remate traz o jogador, o guarda-redes, o resultado, a situação, o sítio, a parte e o segundo', JSON.stringify(r));
  const d = todos?.[1];
  ok(d?.tipoEvento === 'DOIS_MINUTOS' && d.eRemate === false && d.tipoNome === '2 minutos' && d.resultado === null && d.x === null && d.guardaRedesId === null, 'e os outros eventos vêm sem remate', JSON.stringify(d));
  ok((await http('GET', '/api/jogos/99999/eventos')).status === 404, 'GET eventos de um jogo que não existe = 404');
  ok((await http('GET', eventos, undefined, segunda)).status === 404, 'outra conta não vê a lista de eventos (404)');
  ok((await http('GET', eventos, undefined, anonima)).status === 401, 'sem conta: ver a lista de eventos = 401');

  // Corrigir: o remate fora passa a golo de outro jogador, com local na baliza
  const golo = { ...remate, resultado: 'GOLO', jogadorId: lateralCasa, x: 40.5, y: 22, balizaX: 80, balizaY: 15, segundoJogo: 185, sistemaDefensivo: '6_0' };
  ok((await golos(casaId)) === 0, 'antes da correção a casa não tem golos');
  const certo = await http('PUT', `${eventos}/${idRemate}`, golo);
  ok(certo.status === 204, 'PUT evento = 204', descricao(certo));
  let e = await evento(idRemate);
  ok(e?.resultado === 'GOLO' && Number(e.x) === 40.5 && Number(e.y) === 22 && Number(e.balizaX) === 80 && e.balizaZona === 'ALTO_DIR' && e.sistemaDefensivo === '6_0' && e.segundoJogo === 185 && e.id === idRemate,
    'o remate ficou golo, com outro sítio, local na baliza, defesa do adversário e minuto', JSON.stringify(e));
  ok((await golos(casaId)) === 1, 'e as estatísticas contam o golo corrigido');
  ok((await verTodos()).length === 2, 'corrigir não cria outro evento');

  // Voltar a pôr sem local na baliza, noutra parte, noutra situação
  ok((await http('PUT', `${eventos}/${idRemate}`, { ...remate, resultado: 'POSTE', situacao: 'CONTRA_ATAQUE', parte: 2 })).status === 204, 'mudar para poste, contra-ataque e 2.ª parte = 204');
  e = await evento(idRemate);
  ok(e?.resultado === 'POSTE' && e.balizaX === null && e.balizaZona === null && e.situacao === 'CONTRA_ATAQUE' && e.sistemaDefensivo === null && e.parte === 2, 'e o local na baliza e a defesa do adversário deixam de existir', JSON.stringify(e));
  ok((await golos(casaId)) === 0, 'o golo deixa de contar');

  // Mudar de equipa e de tipo num evento que não é remate
  const outro = { tipoEvento: 'FALTA_OFENSIVA', equipaId: casaId, jogadorId: lateralCasa, parte: 2, segundoJogo: 2200 };
  ok((await http('PUT', `${eventos}/${idDois}`, outro)).status === 204, 'passar um 2 minutos à outra equipa e a falta ofensiva = 204');
  e = await evento(idDois);
  ok(e?.tipoEvento === 'FALTA_OFENSIVA' && e.equipaId === casaId && e.jogadorId === lateralCasa && e.segundoJogo === 2200, 'o evento mudou de tipo, de equipa e de jogador', JSON.stringify(e));
  ok((await http('PUT', `${eventos}/${idDois}`, { ...outro, jogadorId: null })).status === 204 && (await evento(idDois))?.jogadorId === null, 'um evento da equipa fica sem jogador');

  // O que a API recusa (e nada muda)
  const antes = JSON.stringify(await verTodos());
  const recusa = async (corpo, status, texto, nome) => {
    const resp = await http('PUT', `${eventos}/${idRemate}`, corpo);
    ok(resp.status === status && (texto ? texto.test(resp.texto) : true), `${nome} = ${status}`, descricao(resp));
  };
  await recusa({ ...remate, equipaId: 99999 }, 400, /equipaId/, 'equipa que não joga o jogo');
  await recusa({ ...remate, tipoEvento: 'NAO_EXISTE' }, 400, /não existe/, 'tipo que não existe');
  await recusa({ ...remate, jogadorId: null }, 400, /jogadorId/, 'remate sem jogador');
  await recusa({ ...remate, jogadorId: lateralFora }, 400, /não pertence à equipa/, 'jogador da outra equipa');
  await recusa({ ...remate, guardaRedesId: grCasa }, 400, /guarda-redes/, 'guarda-redes da própria equipa');
  await recusa({ ...remate, guardaRedesId: lateralFora }, 400, /guarda-redes/, 'guarda-redes que não é guarda-redes');
  await recusa({ ...remate, x: null }, 400, /x e y/, 'remate sem sítio');
  await recusa({ ...remate, resultado: 'FORA', balizaX: 10, balizaY: 10 }, 400, /baliza/, 'local na baliza num remate fora');
  await recusa({ ...remate, situacao: 'SETE_METROS', sistemaDefensivo: '6_0' }, 400, /sistema defensivo/, 'defesa do adversário num 7 metros');
  await recusa({ ...remate, parte: 3 }, 400, /parte/, 'parte 3');
  await recusa({ ...remate, segundoJogo: 7201 }, 400, /segundoJogo/, 'minuto acima do limite');
  await recusa({ tipoEvento: 'PERDA_BOLA', equipaId: casaId, jogadorId: lateralCasa, resultado: 'GOLO', parte: 1, segundoJogo: 1 }, 400, /não são remates/, 'resultado num evento que não é remate');
  await recusa({ tipoEvento: 'VERMELHO', equipaId: casaId, jogadorId: null, parte: 1, segundoJogo: 1 }, 400, /vermelho/, 'vermelho sem jogador');
  ok(JSON.stringify(await verTodos()) === antes, 'e depois de tudo isto nenhum evento mudou');
  ok((await http('PUT', `${eventos}/99999999`, remate)).status === 404, 'corrigir um evento que não existe = 404');
  ok((await http('PUT', `/api/jogos/99999/eventos/${idRemate}`, remate)).status === 404, 'corrigir um evento de um jogo que não existe = 404');
  ok((await http('PUT', `${eventos}/${idRemate}`, remate, segunda)).status === 404, 'outra conta não corrige eventos (404)');
  ok((await http('PUT', `/api/jogos/2/eventos/${idRemate}`, { tipoEvento: 'REMATE', equipaId: 1, jogadorId: 4, resultado: 'GOLO', situacao: 'POSICIONAL', x: 50, y: 25, parte: 1, segundoJogo: 5 })).status === 404, 'um evento só se corrige dentro do seu jogo (404)');
  ok((await http('PUT', `${eventos}/${idRemate}`, remate, anonima)).status === 401, 'sem conta: corrigir um evento = 401');
  ok((await http('PUT', `${eventos}/${idRemate}?c=x`, remate, anonima)).status === 401, 'nem com um código de partilha (401)');

  // Quem está a ver o dashboard recebe os números corrigidos
  const dono = ligarHub(principal);
  const recebidos = [];
  dono.on('EstatisticasAtualizadas', (estado) => recebidos.push(estado));
  await dono.start();
  await dono.invoke('EntrarNoJogo', id, null);
  const antesDoHub = recebidos.length;
  ok((await http('PUT', `${eventos}/${idRemate}`, { ...remate, resultado: 'GOLO' })).status === 204, 'corrigir com o dashboard aberto');
  ok(await ate(() => recebidos.length > antesDoHub), 'o dashboard recebe a atualização em direto');
  ok(recebidos.at(-1)?.equipas?.find((q) => q.equipaId === casaId)?.golos === 1, 'e o estado recebido já tem o golo corrigido');
  await dono.stop();

  // Apagar continua a funcionar e a lista acompanha
  ok((await http('DELETE', `${eventos}/${idDois}`)).status === 204 && (await verTodos()).length === 1, 'apagar um evento tira-o da lista');
  ok((await http('DELETE', `${eventos}/${idDois}`)).status === 404, 'apagar outra vez = 404');
  ok((await http('DELETE', `/api/jogos/${id}`)).status === 204, 'o jogo de teste apaga-se com o que sobrou');
});

// ----------------------------------------------------------------------
await passo('Jogos das últimas 24 horas: a área de convidado vê-os sem link', async () => {
  if (!jogoNovo?.id) return ok(false, 'sem jogo do passo anterior');
  const { id, casaId, foraId } = jogoNovo;
  const doDono = (await http('GET', '/api/jogos')).json ?? [];
  const codigoNovo = doDono.find((j) => j.id === id)?.codigo;
  ok(doDono.length > 0 && doDono.every((j) => j.visivelConvidados === true), 'por omissão todos os jogos aparecem na área de convidado (visivelConvidados = true)');

  // A lista é aberta e não se guarda em cache
  const lista = await http('GET', '/api/convidado/jogos-em-direto', undefined, anonima);
  ok(lista.status === 200 && Array.isArray(lista.json) && /no-store/.test(lista.cabecalhos.get('cache-control') ?? ''), 'a lista de jogos da área de convidado abre-se sem sessão e não se guarda em cache', descricao(lista));
  const meu = lista.json?.find((j) => j.id === id);
  ok(!!meu, 'o jogo que acabou de receber eventos aparece em direto');
  const est = (await http('GET', `/api/jogos/${id}/estatisticas`)).json;
  ok(meu?.golosCasa === est?.equipas?.find((e) => e.equipaId === casaId)?.golos && meu?.golosFora === est?.equipas?.find((e) => e.equipaId === foraId)?.golos,
    `mostra o resultado (${meu?.golosCasa}–${meu?.golosFora}), igual ao das estatísticas`);
  ok(typeof meu?.casaNome === 'string' && typeof meu?.foraNome === 'string' && !Number.isNaN(Date.parse(meu?.ultimoEvento)), 'com os nomes das equipas e a hora do último evento');
  ok(!!codigoNovo && !lista.texto.includes(codigoNovo) && !lista.json.some((j) => 'codigo' in j), 'sem o código do link de partilha');
  ok(!lista.json?.some((j) => j.id === 1 || j.id === 2), 'os jogos de exemplo (de há 3 dias) não aparecem: passaram as 24 horas');
  ok(JSON.stringify(lista.json) === JSON.stringify((await http('GET', '/api/convidado/jogos-em-direto', undefined, segunda)).json), 'quem tem outra conta vê a mesma lista');

  // Quem o abre pela lista (sem código) pode ver tudo o que o link deixa ver, mas não recebe o código
  for (const [nome, sessao] of [['sem conta', anonima], ['com outra conta', segunda]]) {
    const detalhe = await http('GET', `/api/jogos/${id}`, undefined, sessao);
    ok(detalhe.status === 200 && detalhe.json?.jogadores?.length > 0 && (detalhe.json.codigo ?? null) === null, `${nome}: GET /api/jogos/{id} = 200, com jogadores e sem o código de partilha`, descricao(detalhe));
    ok((await http('GET', `/api/jogos/${id}/estatisticas`, undefined, sessao)).status === 200, `${nome}: estatísticas em direto = 200`);
    ok((await http('GET', `/api/jogos/${id}/estatisticas/eficacia?equipaId=${casaId}`, undefined, sessao)).status === 200, `${nome}: eficácia com filtros = 200`);
    const excel = await bruto(`/api/jogos/${id}/exportar.xlsx`, sessao);
    ok(excel.status === 200 && (await excel.arrayBuffer()).byteLength > 1000, `${nome}: pode exportar o Excel`, `HTTP ${excel.status}`);
  }
  ok((await http('GET', `/api/jogos/${id}`)).json?.codigo === codigoNovo, 'o dono continua a receber o código de partilha');
  ok((await http('GET', `/api/jogos/${id}?c=${encodeURIComponent(codigoNovo)}`, undefined, anonima)).status === 200, 'e o link com código continua a servir');

  // Só se pode ler: o resto continua a pedir conta, e só o dono mexe na visibilidade
  const remate = { tipoEvento: 'REMATE', equipaId: casaId, jogadorId: jogoNovo.lateralCasa, guardaRedesId: jogoNovo.grFora, resultado: 'GOLO', situacao: 'POSICIONAL', x: 50, y: 25, parte: 1, segundoJogo: 900 };
  ok((await http('POST', `/api/jogos/${id}/eventos`, remate, anonima)).status === 401, 'sem conta: registar eventos = 401');
  ok((await http('POST', `/api/jogos/${id}/eventos`, remate, segunda)).status === 404, 'outra conta: registar eventos = 404');
  ok((await http('GET', `/api/jogos/${id}/convocados`, undefined, anonima)).status === 401, 'sem conta: a convocatória continua fechada (401)');
  ok((await http('PUT', `/api/jogos/${id}/visibilidade`, { visivel: false }, anonima)).status === 401, 'sem conta: esconder o jogo = 401');
  ok((await http('PUT', `/api/jogos/${id}/visibilidade`, { visivel: false }, segunda)).status === 404, 'outra conta: esconder o jogo = 404');
  ok((await http('PUT', '/api/jogos/99999/visibilidade', { visivel: false })).status === 404, 'esconder um jogo que não existe = 404');
  ok((await http('PUT', `/api/jogos/${id}/visibilidade`, {})).status === 400, 'esconder sem dizer se é para mostrar ou esconder = 400');
  ok((await http('PUT', `/api/jogos/${id}/visibilidade`, { visivel: 'sim' })).status === 400, 'esconder com um valor que não é verdadeiro/falso = 400');
  ok((await http('GET', `/api/convidado/jogos-em-direto`, undefined, anonima)).json?.some((j) => j.id === id), 'nada disto o tirou da lista');

  // Tempo real para quem entra sem link
  const visitante = ligarHub(anonima);
  const recebidos = [];
  visitante.on('EstatisticasAtualizadas', (e) => recebidos.push(e));
  await visitante.start();
  const inicial = await visitante.invoke('EntrarNoJogo', id, null);
  ok(inicial?.jogoId === id && inicial.equipas?.length === 2, 'hub: um jogo em direto abre-se sem código', JSON.stringify(inicial)?.slice(0, 100));
  const golo = await http('POST', `/api/jogos/${id}/eventos`, remate);
  ok(golo.status === 201 && await ate(() => recebidos.length >= 1), 'o convidado recebe a atualização em direto, sem código nem conta', descricao(golo));
  await http('DELETE', `/api/jogos/${id}/eventos/${golo.json?.id}`);
  await visitante.stop();

  // O dono esconde o jogo: sai da lista e fecha-se a quem não tem o link
  ok((await http('PUT', `/api/jogos/${id}/visibilidade`, { visivel: false })).status === 204, 'o dono esconde o jogo = 204');
  ok((await http('GET', '/api/jogos')).json?.find((j) => j.id === id)?.visivelConvidados === false, 'a lista do dono mostra-o como escondido');
  ok(!(await http('GET', '/api/convidado/jogos-em-direto', undefined, anonima)).json?.some((j) => j.id === id), 'escondido: já não está na lista de jogos em direto');
  ok((await http('GET', `/api/jogos/${id}/estatisticas`, undefined, anonima)).status === 404, 'escondido: sem código volta a ser 404');
  ok((await http('GET', `/api/jogos/${id}/exportar.xlsx`, undefined, anonima)).status === 404, 'escondido: o Excel sem código = 404');
  const hubFechado = ligarHub(anonima);
  await hubFechado.start();
  ok(await hubRecusa(hubFechado, id, null), 'escondido: o hub recusa quem não traz o código');
  ok((await hubFechado.invoke('EntrarNoJogo', id, codigoNovo))?.jogoId === id, 'escondido: mas quem tem o link continua a entrar');
  await hubFechado.stop();
  ok((await http('GET', `/api/jogos/${id}/estatisticas?c=${encodeURIComponent(codigoNovo)}`, undefined, anonima)).status === 200, 'escondido: o link de partilha continua a funcionar');

  // Mostrar outra vez
  ok((await http('PUT', `/api/jogos/${id}/visibilidade`, { visivel: true })).status === 204, 'o dono volta a mostrá-lo = 204');
  ok((await http('GET', '/api/convidado/jogos-em-direto', undefined, anonima)).json?.some((j) => j.id === id), 'e volta à lista');
  ok((await http('GET', `/api/jogos/${id}/estatisticas`, undefined, anonima)).status === 200, 'e volta a abrir-se sem código');

  // Sem eventos conta a hora do jogo: de 24 horas antes a 24 horas depois está aberto; fora disso só com o link
  const hora = (horas) => new Date(Date.now() + horas * 3600 * 1000).toISOString();
  const criarJogo = async (dataHora) => (await http('POST', '/api/jogos', { casaId, foraId, ...(dataHora ? { dataHora } : {}) })).json?.id;
  const semHora = await criarJogo();          // sem data: usa a hora atual
  const daquiA3h = await criarJogo(hora(3));
  const ha20h = await criarJogo(hora(-20));
  const daquiA2d = await criarJogo(hora(48));
  const ha3d = await criarJogo(hora(-72));
  const aberta = (await http('GET', '/api/convidado/jogos-em-direto', undefined, anonima)).json ?? [];
  const novoNaLista = aberta.find((j) => j.id === semHora);
  ok(!!novoNaLista && novoNaLista.ultimoEvento === null && novoNaLista.golosCasa === 0 && novoNaLista.golosFora === 0,
    'um jogo novo, ainda sem eventos, aparece na lista (ultimoEvento = null, 0–0)', JSON.stringify(novoNaLista));
  ok(aberta.some((j) => j.id === daquiA3h) && aberta.some((j) => j.id === ha20h), 'um jogo que começa daqui a 3 horas e um de há 20 horas também aparecem');
  ok(!aberta.some((j) => j.id === daquiA2d) && !aberta.some((j) => j.id === ha3d), 'um jogo marcado para daqui a 2 dias e um de há 3 dias não aparecem');
  ok(aberta.findIndex((j) => j.id === id) < aberta.findIndex((j) => j.id === semHora), 'os jogos com eventos vêm antes dos que ainda não começaram');
  for (const [nome, jogo, esperado] of [['sem hora marcada', semHora, 200], ['daqui a 3 horas', daquiA3h, 200], ['de há 20 horas', ha20h, 200], ['daqui a 2 dias', daquiA2d, 404], ['de há 3 dias', ha3d, 404]]) {
    const r = await http('GET', `/api/jogos/${jogo}/estatisticas`, undefined, anonima);
    ok(r.status === esperado, `sem eventos, jogo ${nome}: abrir sem código = ${esperado}`, descricao(r));
  }
  ok((await http('GET', `/api/jogos/${semHora}`, undefined, anonima)).json?.codigo == null, 'e o código do link não é revelado');

  // Escondido, sai da lista e fecha-se a quem não tem o link
  for (const jogo of [semHora, daquiA3h, ha20h]) await http('PUT', `/api/jogos/${jogo}/visibilidade`, { visivel: false });
  const depoisDeEsconder = (await http('GET', '/api/convidado/jogos-em-direto', undefined, anonima)).json ?? [];
  ok(![semHora, daquiA3h, ha20h].some((jogo) => depoisDeEsconder.some((j) => j.id === jogo)), 'os jogos sem eventos escondidos pelo dono saem da lista');
  ok((await http('GET', `/api/jogos/${semHora}/estatisticas`, undefined, anonima)).status === 404, 'e já não se abrem sem código (404)');
  // o jogo da primeira parte do teste (criado sem eventos, em 'Novo jogo') também é visível por omissão: esconde-o
  for (const j of (await http('GET', '/api/jogos')).json ?? []) {
    if (j.id > 2 && j.id !== id && j.visivelConvidados) await http('PUT', `/api/jogos/${j.id}/visibilidade`, { visivel: false });
  }

  // Fica escondido para os passos de privacidade que se seguem
  ok((await http('PUT', `/api/jogos/${id}/visibilidade`, { visivel: false })).status === 204, 'o jogo fica escondido para os passos seguintes');
});

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
  ok(listas[0]?.length === 1 && listas[0][0].nome === equipaSegunda && listas[1]?.length === 0, 'conta alheia: a lista de equipas só tem a sua e a de jogos continua vazia');
  const jogoComEquipaAlheia = await http('POST', '/api/jogos', { casaId: 1, foraId: 2 }, segunda);
  ok(jogoComEquipaAlheia.status === 400, 'criar um jogo com equipas de outra conta = 400', descricao(jogoComEquipaAlheia));

  // Nada mudou na conta principal
  const depois = (await http('GET', '/api/jogos/2/estatisticas')).json;
  ok(depois?.remates?.length === 33 && depois.ultimosEventos.some((e) => e.id === eventoAlheio), 'os pedidos da conta alheia não apagaram nem criaram eventos no jogo 2');
  ok((await http('GET', '/api/jogos/2/convocados')).json?.jogadorIds?.length === 16, 'nem alteraram a convocatória do jogo 2');
  ok((await http('GET', '/api/equipas/1/jogadores')).json?.find((j) => j.id === 4)?.nome === nome4, 'nem o plantel da equipa 1');

  // O mesmo nome de equipa pode existir em contas diferentes; dentro da mesma conta não
  const a = await http('POST', '/api/equipas', { nome: 'Águias do Norte' }, segunda);   // adversária da segunda conta
  ok(a.status === 201, 'a segunda conta pode ter uma equipa com o mesmo nome da primeira', descricao(a));
  ok((await http('POST', '/api/equipas', { nome: 'Águias do Norte' }, segunda)).status === 409, 'mas não duas com o mesmo nome na mesma conta');
  const b = await http('POST', '/api/equipas', { nome: `Equipa B ${sufixo}` }, segunda);
  const meuJogo = await http('POST', '/api/jogos', { casaId: a.json?.id, foraId: b.json?.id }, segunda);
  ok(meuJogo.status === 201, 'a segunda conta cria o seu jogo', descricao(meuJogo));
  // um jogo novo está aberto a convidados durante 24 horas (por omissão): esconde-o para testar o isolamento entre contas
  ok((await http('PUT', `/api/jogos/${meuJogo.json?.id}/visibilidade`, { visivel: false }, segunda)).status === 204, 'a segunda conta esconde o jogo da área de convidado');
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
// Escudos: cada equipa pode ter um (PNG, JPEG ou WebP, até 200 KB). Só o dono o muda; qualquer pessoa o vê.
const PNG_MINIMO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPEG_MINIMO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const WEBP_MINIMO = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(14)]);

/** Envia os bytes de uma imagem (não JSON) como corpo do pedido. */
async function enviarImagem(metodo, caminho, bytes, sessao = principal, tipo = 'image/png') {
  const cabecalhos = { 'Content-Type': tipo };
  if (sessao.cookie) cabecalhos.Cookie = sessao.cookie;
  const resposta = await fetch(API + caminho, { method: metodo, headers: cabecalhos, body: bytes });
  const texto = await resposta.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* sem JSON */ }
  return { status: resposta.status, json, texto };
}

await passo('Escudos das equipas', async () => {
  const principalEq = (await http('GET', '/api/equipas')).json?.find((e) => e.propria);
  const adversaria = (await http('GET', '/api/equipas')).json?.find((e) => !e.propria);
  ok(principalEq && adversaria && principalEq.escudo == null && adversaria.escudo == null, 'escudos: as equipas começam sem escudo (escudo = null)', JSON.stringify(principalEq));
  const caminho = `/api/equipas/${principalEq.id}/escudo`;

  // sem escudo
  const sem = await fetch(API + caminho);
  ok(sem.status === 404, 'escudos: sem escudo, GET = 404');
  ok((await fetch(API + '/api/equipas/99999/escudo')).status === 404, 'escudos: equipa que não existe, GET = 404');

  // só o dono (e só com sessão) o altera
  ok((await enviarImagem('PUT', caminho, PNG_MINIMO, anonima)).status === 401, 'escudos: sem sessão, PUT = 401');
  ok((await http('DELETE', caminho, undefined, anonima)).status === 401, 'escudos: sem sessão, DELETE = 401');
  ok((await enviarImagem('PUT', caminho, PNG_MINIMO, segunda)).status === 404, 'escudos: a conta de outra pessoa não consegue pôr o escudo (404)');
  ok((await http('DELETE', caminho, undefined, segunda)).status === 404, 'escudos: nem tirá-lo (404)');
  ok((await enviarImagem('PUT', '/api/equipas/99999/escudo', PNG_MINIMO)).status === 404, 'escudos: PUT numa equipa que não existe = 404');

  // validações: só PNG, JPEG e WebP (os primeiros bytes mandam, não o que o cliente diz), até 200 KB
  const vazio = await enviarImagem('PUT', caminho, Buffer.alloc(0));
  ok(vazio.status === 400 && /Falta a imagem/.test(vazio.texto), 'escudos: corpo vazio = 400', descricao(vazio));
  const svg = await enviarImagem('PUT', caminho, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), principal, 'image/png');
  ok(svg.status === 400 && /PNG, JPEG ou WebP/.test(svg.texto), 'escudos: um SVG a fingir que é PNG = 400', descricao(svg));
  const html = await enviarImagem('PUT', caminho, Buffer.from('<html></html>'), principal, 'image/jpeg');
  ok(html.status === 400, 'escudos: HTML = 400', descricao(html));
  const grande = await enviarImagem('PUT', caminho, Buffer.concat([PNG_MINIMO, Buffer.alloc(200 * 1024)]));
  ok(grande.status === 413 && /200 KB/.test(grande.texto), 'escudos: mais de 200 KB = 413', descricao(grande));
  ok((await fetch(API + caminho)).status === 404, 'escudos: os pedidos recusados não guardaram nada');

  // guardar: PNG
  const guardado = await enviarImagem('PUT', caminho, PNG_MINIMO);
  ok(guardado.status === 200 && guardado.json?.escudo > 1700000000000, 'escudos: PUT de um PNG = 200 com a versão do escudo', descricao(guardado));
  const versao1 = guardado.json?.escudo;
  const imagem = await fetch(API + caminho);   // sem sessão nem versão: qualquer pessoa o vê
  const bytes = Buffer.from(await imagem.arrayBuffer());
  ok(imagem.status === 200 && imagem.headers.get('content-type') === 'image/png' && bytes.equals(PNG_MINIMO), 'escudos: GET devolve a mesma imagem, como PNG');
  ok(imagem.headers.get('x-content-type-options') === 'nosniff', 'escudos: o browser não adivinha o tipo da imagem (nosniff)');
  ok(imagem.headers.get('cache-control') === 'no-cache' && !!imagem.headers.get('etag'), 'escudos: sem versão no endereço o browser pergunta sempre (ETag)');
  const comVersao = await fetch(`${API}${caminho}?v=${versao1}`);
  ok(comVersao.headers.get('cache-control') === 'public, max-age=86400', 'escudos: com a versão no endereço a imagem fica um dia na cache');
  const semMudar = await fetch(API + caminho, { headers: { 'If-None-Match': imagem.headers.get('etag') } });
  ok(semMudar.status === 304, 'escudos: com o ETag certo a API responde 304 (sem a imagem)');

  // a versão chega a tudo o que mostra equipas
  ok((await http('GET', '/api/equipas')).json?.find((e) => e.id === principalEq.id)?.escudo === versao1, 'escudos: GET /api/equipas traz a versão do escudo');
  ok((await http('GET', '/api/equipas')).json?.find((e) => e.id === adversaria.id)?.escudo == null, 'escudos: a equipa sem escudo continua com null');
  const jogoComEscudo = await http('POST', '/api/jogos', { casaId: principalEq.id, foraId: adversaria.id });
  const idJogoEscudo = jogoComEscudo.json?.id;
  const detalhe = (await http('GET', `/api/jogos/${idJogoEscudo}`)).json;
  ok(detalhe?.casaEscudo === versao1 && detalhe.foraEscudo == null, 'escudos: o jogo traz a versão do escudo de cada equipa', JSON.stringify(detalhe));
  ok((await http('GET', '/api/jogos')).json?.find((j) => j.id === idJogoEscudo)?.casaEscudo === versao1, 'escudos: a lista de jogos também');
  const estado = (await http('GET', `/api/jogos/${idJogoEscudo}/estatisticas`)).json;
  ok(estado?.equipas?.find((e) => e.equipaId === principalEq.id)?.escudo === versao1 && estado.equipas.find((e) => e.equipaId === adversaria.id)?.escudo == null,
    'escudos: o estado do dashboard (e do tempo real) traz o escudo de cada equipa');
  const aoVivo = (await http('GET', '/api/convidado/jogos-em-direto', undefined, anonima)).json?.find((j) => j.id === idJogoEscudo);
  ok(aoVivo?.casaId === principalEq.id && aoVivo.casaEscudo === versao1 && aoVivo.foraId === adversaria.id && aoVivo.foraEscudo == null,
    'escudos: a lista da área de convidado traz os ids e o escudo', JSON.stringify(aoVivo));

  // trocar: JPEG e depois WebP (cada um muda a versão e o tipo); continua a haver um só
  await esperar(5);
  const troca = await enviarImagem('PUT', caminho, JPEG_MINIMO, principal, 'application/octet-stream');
  ok(troca.status === 200 && troca.json?.escudo > versao1, 'escudos: trocar por um JPEG muda a versão (o tipo vem dos bytes, não do cabeçalho)', descricao(troca));
  const jpeg = await fetch(API + caminho);
  ok(jpeg.headers.get('content-type') === 'image/jpeg' && Buffer.from(await jpeg.arrayBuffer()).equals(JPEG_MINIMO), 'escudos: GET passa a devolver o JPEG');
  const webp = await enviarImagem('PUT', caminho, WEBP_MINIMO);
  ok(webp.status === 200 && (await fetch(API + caminho)).headers.get('content-type') === 'image/webp', 'escudos: e depois um WebP');
  ok(webp.json?.escudo > troca.json?.escudo, 'escudos: cada troca tem uma versão nova');
  ok((await enviarImagem('PUT', caminho, Buffer.concat([PNG_MINIMO, Buffer.alloc(100 * 1024)]))).status === 200, 'escudos: até 200 KB é aceite');

  // tirar o escudo
  ok((await http('DELETE', caminho)).status === 204, 'escudos: DELETE = 204');
  ok((await fetch(API + caminho)).status === 404, 'escudos: depois de tirado, GET = 404');
  ok((await http('GET', '/api/equipas')).json?.find((e) => e.id === principalEq.id)?.escudo == null, 'escudos: e a equipa volta a ter escudo = null');
  ok((await http('DELETE', caminho)).status === 204, 'escudos: tirar um escudo que já não existe também dá 204');

  // o jogo criado aqui fica escondido, para os passos de privacidade que se seguem
  await http('PUT', `/api/jogos/${idJogoEscudo}/visibilidade`, { visivel: false });
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
