// Os cabeçalhos de segurança (CSP, HSTS...) estão em frontend/cabecalhos-seguranca.conf. O nginx só herda os add_header
// do servidor para um location que não tenha nenhum seu: por isso o ficheiro tem de entrar em cada location com
// add_header próprio, senão essas respostas (o sw.js, os ficheiros estáticos...) saem sem proteção e ninguém repara.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend');
const ler = (nome) => fs.readFileSync(path.join(FRONTEND, nome), 'utf8');
const conf = ler('nginx.conf');
const cabecalhos = ler('cabecalhos-seguranca.conf');
const INCLUDE = 'include /etc/nginx/cabecalhos-seguranca.conf;';

/** Os blocos `location ... { ... }` do nginx.conf (sem chavetas dentro, que o ficheiro não tem). */
function locations() {
  return [...conf.matchAll(/location\s+([^{]+?)\s*\{([^}]*)\}/g)].map(([, nome, corpo]) => ({ nome, corpo }));
}

test('o servidor e cada location com add_header próprio incluem os cabeçalhos de segurança', () => {
  const blocos = locations();
  assert.ok(blocos.length >= 5, 'o nginx.conf tem os seus locations');
  const servidor = conf.slice(conf.indexOf('server {'), conf.indexOf('location'));
  assert.ok(servidor.includes(INCLUDE), 'o bloco server não inclui os cabeçalhos');
  for (const { nome, corpo } of blocos) {
    if (/add_header/.test(corpo)) assert.ok(corpo.includes(INCLUDE), `o location ${nome} tem add_header e não inclui os cabeçalhos de segurança`);
  }
});

test('a API e o hub não repetem o X-Content-Type-Options que o nginx já põe', () => {
  for (const { nome, corpo } of locations().filter((l) => /^\/(api|hub)\//.test(l.nome))) {
    assert.ok(/proxy_hide_header\s+X-Content-Type-Options/.test(corpo), `o location ${nome} deixa passar o cabeçalho duplicado da API`);
  }
});

test('os cabeçalhos de segurança estão todos lá e a CSP não abre portas', () => {
  for (const nome of ['Content-Security-Policy', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy', 'Strict-Transport-Security']) {
    assert.ok(new RegExp(`add_header\\s+${nome}\\s`).test(cabecalhos), `falta ${nome}`);
  }
  const csp = /Content-Security-Policy\s+"([^"]+)"/.exec(cabecalhos)?.[1] ?? '';
  const diretivas = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([nome, ...valores]) => [nome, valores]));
  assert.deepEqual(diretivas['default-src'], ["'self'"]);
  assert.deepEqual(diretivas['frame-ancestors'], ["'none'"]);
  assert.deepEqual(diretivas['object-src'], ["'none'"]);
  assert.deepEqual(diretivas['base-uri'], ["'self'"]);
  assert.deepEqual(diretivas['form-action'], ["'self'"]);
  // scripts só do próprio site (o 'wasm-unsafe-eval' é do leitor de fotos): nunca scripts em linha nem eval
  assert.deepEqual(diretivas['script-src'], ["'self'", "'wasm-unsafe-eval'"]);
  assert.ok(!csp.includes("'unsafe-eval'") && !/\bhttps?:|\*/.test(csp), 'a CSP abre-se a sítios de fora');
  // todos os cabeçalhos levam `always`, para também saírem nas respostas de erro (404, 502...)
  for (const linha of cabecalhos.split('\n').filter((l) => l.startsWith('add_header'))) assert.ok(/\balways;\s*$/.test(linha), `sem always: ${linha}`);
});

test('o HSTS só vai quando por fora é HTTPS', () => {
  assert.match(conf, /map\s+\$proto_externo\s+\$hsts\s*\{[^}]*https\s+"max-age=\d+"[^}]*default\s+""/s);
  assert.match(cabecalhos, /Strict-Transport-Security\s+\$hsts\s+always;/);
});

test('o Dockerfile leva os cabeçalhos para onde o nginx.conf os procura', () => {
  const dockerfile = ler('Dockerfile');
  assert.match(dockerfile, /COPY\s+cabecalhos-seguranca\.conf\s+\/etc\/nginx\/cabecalhos-seguranca\.conf/);
  assert.ok(fs.existsSync(path.join(FRONTEND, 'cabecalhos-seguranca.conf')));
});

test('nenhuma página tem scripts nem manipuladores em linha (a CSP bloqueava-os)', () => {
  for (const pagina of fs.readdirSync(FRONTEND).filter((f) => f.endsWith('.html'))) {
    const html = ler(pagina);
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), `${pagina} tem um <script> em linha`);
    assert.ok(!/\son(click|load|change|submit|input|error|keydown)\s*=/i.test(html), `${pagina} tem um manipulador de evento em linha`);
    assert.ok(!/href\s*=\s*["']javascript:/i.test(html), `${pagina} tem um endereço javascript:`);
  }
});

test('o nginx comprime o texto e deixa as letras um ano na cache e os ícones uma semana', () => {
  assert.match(conf, /^\s*gzip on;/m);
  assert.match(conf, /^\s*gzip_proxied any;/m, 'sem isto o JSON da API que passa pelo túnel não se comprime');
  const tipos = /gzip_types\s+([^;]+);/.exec(conf.slice(conf.indexOf('server {'), conf.indexOf('location')))?.[1].split(/\s+/) ?? [];
  for (const tipo of ['text/css', 'text/javascript', 'application/javascript', 'application/json', 'image/svg+xml']) assert.ok(tipos.includes(tipo), `não comprime ${tipo}`);
  assert.ok(!tipos.some((t) => /spreadsheet|image\/(png|jpeg|webp)|woff/.test(t)), 'comprimir ficheiros já comprimidos só gasta CPU');
  const bloco = (nome) => locations().find((l) => l.nome === nome)?.corpo ?? '';
  assert.match(bloco('/fonts/'), /Cache-Control "public, max-age=31536000, immutable"/);
  assert.match(bloco('/icons/'), /Cache-Control "public, max-age=604800"/);
  // o resto (páginas, JS, CSS) não tem nomes com versão: tem de perguntar sempre se mudou
  assert.match(bloco('/'), /Cache-Control "no-cache"/);
});

test('todas as páginas pedem logo no início as letras que usam ao desenhar (senão o texto salta quando elas chegam)', () => {
  const LETRAS = ['barlow-latin-400-normal', 'barlow-latin-600-normal', 'barlow-condensed-latin-700-normal'];
  const paginas = fs.readdirSync(FRONTEND).filter((f) => f.endsWith('.html') && ler(f).includes('css/estilo.css'));
  assert.ok(paginas.length >= 15);
  for (const pagina of paginas) {
    const html = ler(pagina);
    const css = html.indexOf('<link rel="stylesheet" href="css/estilo.css">');
    for (const letra of LETRAS) {
      const linha = `<link rel="preload" href="fonts/${letra}.woff2" as="font" type="font/woff2" crossorigin>`;
      assert.ok(html.includes(linha), `${pagina} não pede a letra ${letra} no início`);
      assert.ok(html.indexOf(linha) < css, `${pagina}: o pedido da letra ${letra} tem de vir antes do CSS`);
    }
  }
  for (const letra of LETRAS) assert.ok(fs.existsSync(path.join(FRONTEND, 'fonts', `${letra}.woff2`)), `falta o ficheiro ${letra}`);
  // e o CSS usa-as com o mesmo peso (400, 600, condensada 700)
  const css = ler('css/estilo.css');
  for (const letra of LETRAS) assert.ok(css.includes(`fonts/${letra}.woff2`), `o CSS não declara ${letra}`);
});
