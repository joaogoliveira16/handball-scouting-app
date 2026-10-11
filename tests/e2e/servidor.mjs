// Servidor de teste: faz o papel do nginx da imagem do frontend.
//   - serve os ficheiros de frontend/ (páginas, JS, CSS, fontes);
//   - reencaminha /api/* e /hub/* (incluindo WebSockets) para a API real.
// Assim o browser fala sempre com a mesma origem, tal como em produção.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
};

export async function iniciarServidor({ apiUrl = 'http://localhost:5080', porta = 0 } = {}) {
  const api = new URL(apiUrl);

  function reencaminhar(req, res) {
    const pedido = http.request({
      host: api.hostname, port: api.port || 80, method: req.method, path: req.url,
      headers: { ...req.headers, host: api.host },
    }, (resposta) => {
      res.writeHead(resposta.statusCode ?? 502, resposta.headers);
      resposta.pipe(res);
    });
    pedido.on('error', (erro) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: `API inacessível: ${erro.message}` }));
    });
    req.pipe(pedido);
  }

  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/hub/')) return reencaminhar(req, res);

    const ficheiro = path.join(FRONTEND, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (!ficheiro.startsWith(FRONTEND + path.sep) || !fs.existsSync(ficheiro) || fs.statSync(ficheiro).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('não encontrado');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(ficheiro)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(ficheiro).pipe(res);
  });

  // WebSockets: liga um socket TCP à API e passa os bytes de um lado para o outro
  const ligacoes = new Set();
  servidor.on('upgrade', (req, socket, cabeca) => {
    const destino = net.connect(Number(api.port || 80), api.hostname, () => {
      const cabecalhos = Object.entries({ ...req.headers, host: api.host }).map(([k, v]) => `${k}: ${v}`).join('\r\n');
      destino.write(`${req.method} ${req.url} HTTP/1.1\r\n${cabecalhos}\r\n\r\n`);
      if (cabeca?.length) destino.write(cabeca);
      socket.pipe(destino).pipe(socket);
    });
    ligacoes.add(socket).add(destino);
    for (const s of [socket, destino]) s.on('close', () => ligacoes.delete(s));
    destino.on('error', () => socket.destroy());
    socket.on('error', () => destino.destroy());
  });

  await new Promise((resolve) => servidor.listen(porta, resolve));
  const url = `http://localhost:${servidor.address().port}`;
  return {
    url,
    fechar: () => new Promise((resolve) => {
      servidor.closeAllConnections?.();
      for (const ligacao of ligacoes) ligacao.destroy(); // os WebSockets não contam para closeAllConnections
      servidor.close(() => resolve());
      setTimeout(resolve, 2000).unref();
    }),
  };
}

// Arranque manual: node e2e/servidor.mjs  (API_URL e PORTA opcionais)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const servidor = await iniciarServidor({ apiUrl: process.env.API_URL, porta: Number(process.env.PORTA ?? 8080) });
  console.log(`Frontend em ${servidor.url} (API: ${process.env.API_URL ?? 'http://localhost:5080'})`);
}
