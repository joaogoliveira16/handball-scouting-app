// Teste de integração da API verdadeira (HTTP + SignalR + Excel) contra uma base PostgreSQL com os dados de exemplo.
//
//   API_URL=http://localhost:5080 EXCEL_DIR=./resultados node integracao/integracao.mjs
//
// Precisa da API a correr e da base de dados criada com db/init/*.sql. Sai com código 1 se alguma verificação falhar.
import fs from 'node:fs';
import path from 'node:path';
import * as signalR from '@microsoft/signalr';

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

async function http(metodo, caminho, corpo) {
  const resposta = await fetch(API + caminho, {
    method: metodo,
    headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* resposta sem JSON */ }
  return { status: resposta.status, json, texto, cabecalhos: resposta.headers };
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
  const ligacao = new signalR.HubConnectionBuilder()
    .withUrl(`${API}/hub/jogo`)
    .configureLogging(signalR.LogLevel.Warning)
    .build();
  ligacao.on('EstatisticasAtualizadas', (estado) => recebidos.push(estado));

  await ligacao.start();
  ok(ligacao.state === signalR.HubConnectionState.Connected, 'ligação ao hub /hub/jogo');
  const inicial = await ligacao.invoke('EntrarNoJogo', id);
  ok(inicial?.jogoId === id && inicial.equipas?.length === 2, 'EntrarNoJogo devolve o estado atual', JSON.stringify(inicial)?.slice(0, 120));

  let erroHub = null;
  try { await ligacao.invoke('EntrarNoJogo', 99999); } catch (e) { erroHub = e; }
  ok(erroHub !== null, 'EntrarNoJogo de jogo inexistente dá erro');

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
  const outro = new signalR.HubConnectionBuilder().withUrl(`${API}/hub/jogo`).configureLogging(signalR.LogLevel.Error).build();
  const doOutroJogo = [];
  outro.on('EstatisticasAtualizadas', (e) => doOutroJogo.push(e));
  await outro.start();
  await outro.invoke('EntrarNoJogo', 2);
  await http('POST', `/api/jogos/${id}/eventos`, { ...remate, segundoJogo: 300 });
  await esperar(500);
  ok(doOutroJogo.length === 0, 'quem está noutro jogo não recebe as atualizações deste');
  await outro.stop();

  await ligacao.stop();
  ok(true, 'ligações fechadas');
});

function lateralFora(j) { return j.lateralFora; }

// ----------------------------------------------------------------------
await passo('Exportação para Excel', async () => {
  async function descarregar(caminho, ficheiro) {
    const r = await fetch(API + caminho);
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

  ok((await fetch(`${API}/api/jogos/2/exportar.xlsx?equipaId=999`)).status === 400, 'equipa que não joga neste jogo = 400');
  ok((await fetch(`${API}/api/jogos/99999/exportar.xlsx`)).status === 404, 'jogo inexistente = 404');

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
