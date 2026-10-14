// Service worker: guarda a app (páginas, JS, CSS, letras, ícones) no tablet para o banco abrir sem rede.
//
// Só trata de ficheiros estáticos do próprio site. A API (/api) e o tempo real (/hub) nunca passam por aqui:
// quem os chama (a fila de eventos do banco) é que sabe o que fazer quando falham.
//
// Estratégia: rede primeiro. Com rede, a página é sempre a versão mais recente (e fica guardada); sem rede, ou se a
// rede demorar mais de 3 s (o wifi de um pavilhão arrasta-se), usa a última versão guardada.
//
// Ao acrescentar um ficheiro ao banco (um módulo novo no import de banco.js, por exemplo) acrescenta-o também a
// PRECACHE — o teste tests/unidade/sw.test.mjs falha se faltar algum.

const PREFIXO = 'scouting-estatico-';
const CACHE = `${PREFIXO}v1`;
const TEMPO_REDE_MS = 3000;

const PRECACHE = [
  './',
  'index.html',
  'banco.html',
  'manifest.webmanifest',
  'css/estilo.css',
  'fonts/barlow-latin-400-normal.woff2',
  'fonts/barlow-latin-500-normal.woff2',
  'fonts/barlow-latin-600-normal.woff2',
  'fonts/barlow-latin-700-normal.woff2',
  'fonts/barlow-condensed-latin-600-normal.woff2',
  'fonts/barlow-condensed-latin-700-normal.woff2',
  'lib/signalr.min.js',
  'js/api.js',
  'js/baliza.js',
  'js/banco.js',
  'js/campo.js',
  'js/conta.js',
  'js/dom.js',
  'js/escudo.js',
  'js/faixa-numerica.js',
  'js/fila.js',
  'js/index.js',
  'js/numerica.js',
  'js/offline.js',
  'js/otimista.js',
  'js/tempo-real.js',
  'js/timeout.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

const absoluto = (caminho) => new URL(caminho, self.location).href;

self.addEventListener('install', (evento) => {
  evento.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Um ficheiro que falhe não impede os outros: o que faltar guarda-se quando for pedido
    await Promise.allSettled(PRECACHE.map((caminho) => cache.add(new Request(absoluto(caminho), { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    for (const nome of await caches.keys()) {
      if (nome.startsWith(PREFIXO) && nome !== CACHE) await caches.delete(nome);
    }
    await self.clients.claim();
  })());
});

/** Páginas guardam-se pelo caminho (banco.html?jogo=3 e banco.html?jogo=4 são a mesma página); o resto pelo URL. */
function chaveDe(pedido) {
  const url = new URL(pedido.url);
  return pedido.mode === 'navigate' ? url.origin + url.pathname : url.href;
}

async function responder(evento, chave) {
  const pedido = evento.request;
  const rede = fetch(pedido).then((resposta) => {
    if (resposta.ok && resposta.type === 'basic') {
      const copia = resposta.clone();
      evento.waitUntil(caches.open(CACHE).then((cache) => cache.put(chave, copia)).catch(() => {}));
    }
    return resposta;
  });
  rede.catch(() => {});   // se ganhar o que está guardado, a rede falhar depois não é um erro por tratar

  const prazo = new Promise((resolve) => { setTimeout(resolve, TEMPO_REDE_MS, null); });
  try {
    const primeira = await Promise.race([rede, prazo]);
    if (primeira) return primeira;
  } catch { /* sem rede: vale o que está guardado */ }

  const guardado = await caches.match(chave);
  if (guardado) return guardado;
  return rede;   // nada guardado: espera pela rede (e falha como falharia sem service worker)
}

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/hub/')) return;
  if (url.pathname.startsWith('/lib/tesseract/')) return;   // o leitor de fotos tem a sua própria cache (nginx)
  evento.respondWith(responder(evento, chaveDe(pedido)));
});
