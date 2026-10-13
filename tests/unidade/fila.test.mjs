// Testes da fila de eventos do banco (frontend/js/fila.js): guardar, enviar por ordem, repetir e rejeitar.
//   node --no-warnings --test unidade/
import assert from 'node:assert/strict';
import test from 'node:test';
import { classificar, criarEnvio, criarFila, drenar, novoId } from '../../frontend/js/fila.js';

/** Um localStorage de brincar (guarda texto, como o verdadeiro). */
function armazenamentoFalso({ falhaAoGuardar = false } = {}) {
  const dados = new Map();
  return {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => { if (falhaAoGuardar) throw new Error('cheio'); dados.set(k, String(v)); },
    dados,
  };
}
const filaDe = (armazenamento = armazenamentoFalso(), extra = {}) => {
  let n = 0;
  return criarFila({ armazenamento, gerarId: () => `id-${++n}`, agora: () => new Date('2026-10-11T21:00:00Z'), ...extra });
};
const erroHttp = (status) => Object.assign(new Error(`Erro ${status}`), { status });
const erroRede = () => new TypeError('Failed to fetch');

test('cada evento guardado leva o identificador do tablet e a hora a que aconteceu', () => {
  const fila = filaDe();
  const item = fila.adicionar(7, { tipoEvento: 'TIMEOUT', equipaId: 1, parte: 1, segundoJogo: 600 });
  assert.equal(item.clienteId, 'id-1');
  assert.equal(item.corpo.clienteId, 'id-1');
  assert.equal(item.corpo.ocorridoEm, '2026-10-11T21:00:00.000Z');
  assert.equal(item.corpo.segundoJogo, 600);
  assert.equal(item.jogoId, 7);
});

test('a fila sobrevive a recarregar a página (fica no armazenamento) e mantém a ordem', () => {
  const armazenamento = armazenamentoFalso();
  const a = filaDe(armazenamento);
  a.adicionar(7, { tipoEvento: 'A' });
  a.adicionar(7, { tipoEvento: 'B' });
  const depois = filaDe(armazenamento);   // "página nova" sobre o mesmo armazenamento
  assert.deepEqual(depois.todos().map((i) => i.corpo.tipoEvento), ['A', 'B']);
  assert.equal(depois.contar(), 2);
});

test('doJogo só devolve os eventos desse jogo e remover tira um só', () => {
  const fila = filaDe();
  const a = fila.adicionar(7, { tipoEvento: 'A' });
  fila.adicionar(8, { tipoEvento: 'B' });
  fila.adicionar(7, { tipoEvento: 'C' });
  assert.deepEqual(fila.doJogo(7).map((i) => i.corpo.tipoEvento), ['A', 'C']);
  assert.equal(fila.remover(a.clienteId), true);
  assert.equal(fila.remover(a.clienteId), false);
  assert.deepEqual(fila.todos().map((i) => i.corpo.tipoEvento), ['B', 'C']);
});

test('um armazenamento estragado ou cheio não quebra: a fila passa a viver em memória', () => {
  const estragado = armazenamentoFalso();
  estragado.dados.set('scouting.fila.v1', '{não é json');
  const fila = filaDe(estragado);
  assert.deepEqual(fila.todos(), []);
  fila.adicionar(1, { tipoEvento: 'A' });
  assert.equal(fila.contar(), 1);
  assert.equal(fila.emMemoria, true);

  const cheio = filaDe(armazenamentoFalso({ falhaAoGuardar: true }));
  cheio.adicionar(1, { tipoEvento: 'A' });
  cheio.adicionar(1, { tipoEvento: 'B' });
  assert.deepEqual(cheio.todos().map((i) => i.corpo.tipoEvento), ['A', 'B']);
});

test('o identificador novo parece um UUID v4 e não se repete (também sem crypto.randomUUID)', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const ids = new Set();
  try {
    for (const semRandomUUID of [false, true]) {
      if (semRandomUUID) Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: (b) => globalThis.__crypto.getRandomValues(b) }, configurable: true });
      else globalThis.__crypto = original?.value ?? globalThis.crypto;
      for (let i = 0; i < 50; i += 1) ids.add(novoId());
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    delete globalThis.__crypto;
  }
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('classificar: sem resposta é rede, 401 é sessão, 5xx repete-se e o resto é recusa', () => {
  assert.equal(classificar(erroRede()), 'rede');
  assert.equal(classificar(erroHttp(401)), 'sessao');
  for (const s of [408, 429, 500, 502, 503, 504]) assert.equal(classificar(erroHttp(s)), 'transitorio', String(s));
  for (const s of [400, 403, 404, 409, 422]) assert.equal(classificar(erroHttp(s)), 'rejeitado', String(s));
});

test('drenar envia por ordem e esvazia a fila', async () => {
  const fila = filaDe();
  for (const t of ['A', 'B', 'C']) fila.adicionar(1, { tipoEvento: t });
  const enviados = [];
  const r = await drenar(fila, async (item) => { enviados.push(item.corpo.tipoEvento); });
  assert.deepEqual(enviados, ['A', 'B', 'C']);
  assert.deepEqual(r, { estado: 'vazia', enviados: 3, rejeitados: [] });
  assert.equal(fila.contar(), 0);
});

test('sem rede pára no primeiro evento e não perde nenhum; quando a rede volta continua do mesmo sítio', async () => {
  const fila = filaDe();
  for (const t of ['A', 'B', 'C']) fila.adicionar(1, { tipoEvento: t });
  let rede = false;
  const enviados = [];
  const enviar = async (item) => { if (!rede) throw erroRede(); enviados.push(item.corpo.tipoEvento); };

  const sem = await drenar(fila, enviar);
  assert.equal(sem.estado, 'sem-rede');
  assert.equal(fila.contar(), 3);

  rede = true;
  fila.adicionar(1, { tipoEvento: 'D' });   // registado entretanto
  const com = await drenar(fila, enviar);
  assert.equal(com.estado, 'vazia');
  assert.deepEqual(enviados, ['A', 'B', 'C', 'D']);
});

test('a rede cai a meio: os que já seguiram saem da fila e os outros ficam', async () => {
  const fila = filaDe();
  for (const t of ['A', 'B', 'C']) fila.adicionar(1, { tipoEvento: t });
  let chamadas = 0;
  const r = await drenar(fila, async () => { if (++chamadas === 2) throw erroRede(); });
  assert.equal(r.estado, 'sem-rede');
  assert.equal(r.enviados, 1);
  assert.deepEqual(fila.todos().map((i) => i.corpo.tipoEvento), ['B', 'C']);
});

test('um evento que o servidor recusa sai da fila e avisa, sem encravar os seguintes', async () => {
  const fila = filaDe();
  for (const t of ['A', 'MAU', 'C']) fila.adicionar(1, { tipoEvento: t });
  const recusados = [];
  const enviados = [];
  const r = await drenar(fila, async (item) => {
    if (item.corpo.tipoEvento === 'MAU') throw erroHttp(400);
    enviados.push(item.corpo.tipoEvento);
  }, { aoRejeitar: (item, erro) => recusados.push([item.corpo.tipoEvento, erro.status]) });
  assert.deepEqual(enviados, ['A', 'C']);
  assert.deepEqual(recusados, [['MAU', 400]]);
  assert.equal(r.estado, 'vazia');
  assert.equal(r.rejeitados.length, 1);
  assert.equal(fila.contar(), 0);
});

test('erros do servidor repetem-se até um limite e depois o evento é recusado', async () => {
  const fila = filaDe();
  fila.adicionar(1, { tipoEvento: 'A' });
  fila.adicionar(1, { tipoEvento: 'B' });
  const recusados = [];
  const enviar = async (item) => { if (item.corpo.tipoEvento === 'A') throw erroHttp(500); };
  for (let i = 1; i < 3; i += 1) {
    const r = await drenar(fila, enviar, { maximoTentativas: 3, aoRejeitar: (item) => recusados.push(item.corpo.tipoEvento) });
    assert.equal(r.estado, 'erro-servidor', `tentativa ${i}`);
    assert.equal(fila.contar(), 2);
  }
  const ultima = await drenar(fila, enviar, { maximoTentativas: 3, aoRejeitar: (item) => recusados.push(item.corpo.tipoEvento) });
  assert.equal(ultima.estado, 'vazia');   // A recusado à 3.ª, B seguiu
  assert.deepEqual(recusados, ['A']);
});

test('com a sessão terminada a fila fica intacta à espera de a pessoa entrar', async () => {
  const fila = filaDe();
  fila.adicionar(1, { tipoEvento: 'A' });
  const r = await drenar(fila, async () => { throw erroHttp(401); });
  assert.equal(r.estado, 'sessao');
  assert.equal(fila.contar(), 1);
});

test('quem envia nunca corre duas vezes ao mesmo tempo e continua o que ficou por enviar', async () => {
  const fila = filaDe();
  fila.adicionar(1, { tipoEvento: 'A' });
  const enviados = [];
  let largar;
  const trava = new Promise((resolve) => { largar = resolve; });
  const envio = criarEnvio({
    fila, enviar: async (item) => { enviados.push(item.corpo.tipoEvento); await trava; },
    agendar: () => 0, cancelar: () => {},
  });
  const primeira = envio.tentar();
  assert.equal(envio.aCorrer, true);
  assert.equal(await envio.tentar(), null);   // já está a correr
  fila.adicionar(1, { tipoEvento: 'B' });     // registado enquanto o A seguia
  largar();
  await primeira;
  assert.deepEqual(enviados, ['A', 'B']);
  assert.equal(fila.contar(), 0);
  assert.equal(envio.aCorrer, false);
});

test('sem rede o envio agenda nova tentativa (com esperas crescentes) e volta ao normal quando a fila esvazia', async () => {
  const fila = filaDe();
  fila.adicionar(1, { tipoEvento: 'A' });
  const esperasPedidas = [];
  let rede = false;
  const terminados = [];
  const envio = criarEnvio({
    fila, enviar: async () => { if (!rede) throw erroRede(); },
    esperas: [10, 20, 30], agendar: (_f, ms) => { esperasPedidas.push(ms); return ms; }, cancelar: () => {},
    aoTerminar: (r) => terminados.push(r.estado),
  });
  for (let i = 0; i < 5; i += 1) await envio.tentar();
  assert.deepEqual(esperasPedidas, [10, 20, 30, 30, 30]);
  rede = true;
  await envio.tentar();
  assert.deepEqual(terminados.at(-1), 'vazia');
  fila.adicionar(1, { tipoEvento: 'B' });
  rede = false;
  await envio.tentar();
  assert.equal(esperasPedidas.at(-1), 10);   // a contagem das falhas recomeçou
});

test('com a sessão terminada não agenda nova tentativa', async () => {
  const fila = filaDe();
  fila.adicionar(1, { tipoEvento: 'A' });
  const pedidas = [];
  const envio = criarEnvio({ fila, enviar: async () => { throw erroHttp(401); }, agendar: (_f, ms) => pedidas.push(ms), cancelar: () => {} });
  await envio.tentar();
  assert.deepEqual(pedidas, []);
});
