// O service worker guarda a app no tablet para o banco abrir sem rede. Se faltar um ficheiro na lista, a página
// abre «aos pedaços» sem rede (sem estilo, sem um módulo) e só se descobre no pavilhão: por isso confere-se aqui
// que a lista cobre tudo o que o banco e a lista de jogos carregam.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend');
const ler = (ficheiro) => fs.readFileSync(path.join(FRONTEND, ficheiro), 'utf8');

const codigoSw = ler('sw.js');
const PRECACHE = new Function(`${/const PRECACHE = (\[[\s\S]*?\]);/.exec(codigoSw)[1].replace(/^/, 'return ')}`)();

/** Caminho do ficheiro tal como o service worker o lista (./ é a página inicial). */
const comoLista = (caminho) => (caminho === 'index.html' ? ['index.html', './'] : [caminho]);

/** Ficheiros que uma página html carrega (scripts, estilos, manifest e ícones), relativos à raiz do site. */
function referenciasDoHtml(ficheiro) {
  const html = ler(ficheiro);
  const refs = [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"#?]+)"/g)].map((m) => m[1]);
  return refs.filter((r) => !/^(https?:)?\/\//.test(r));
}

/** Todos os módulos que um módulo importa, e os que esses importam... */
function fecho(inicio) {
  const vistos = new Set();
  const porVer = [inicio];
  while (porVer.length) {
    const atual = porVer.pop();
    if (vistos.has(atual)) continue;
    vistos.add(atual);
    for (const m of ler(atual).matchAll(/^\s*(?:import|export)\b[^'"]*?from\s*['"](\.[^'"]+)['"]/gm)) {
      porVer.push(path.posix.join(path.posix.dirname(atual), m[1]));
    }
  }
  return [...vistos];
}

/** Ficheiros que o css pede com url() (as letras), fora os dados embutidos. */
function urlsDoCss(ficheiro) {
  const css = ler(ficheiro);
  return [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)]
    .map((m) => m[1])
    .filter((u) => !u.startsWith('data:'))
    .map((u) => path.posix.normalize(path.posix.join(path.posix.dirname(ficheiro), u)));
}

test('a lista do service worker não tem repetidos nem ficheiros que não existem', () => {
  assert.equal(new Set(PRECACHE).size, PRECACHE.length, 'ficheiro repetido na lista');
  for (const caminho of PRECACHE) {
    if (caminho === './') continue;
    assert.ok(fs.existsSync(path.join(FRONTEND, caminho)), `${caminho} está na lista mas não existe`);
  }
});

for (const pagina of ['banco.html', 'index.html']) {
  test(`${pagina}: o service worker guarda a página e tudo o que ela carrega`, () => {
    assert.ok(comoLista(pagina).every((c) => PRECACHE.includes(c)), `${pagina} falta na lista`);
    for (const ref of referenciasDoHtml(pagina)) {
      assert.ok(PRECACHE.includes(ref), `${pagina} carrega ${ref}, que falta na lista do service worker`);
    }
  });
}

for (const modulo of ['js/banco.js', 'js/index.js']) {
  test(`${modulo}: todos os módulos que importa estão na lista`, () => {
    for (const ficheiro of fecho(modulo)) {
      assert.ok(PRECACHE.includes(ficheiro), `${ficheiro} (importado a partir de ${modulo}) falta na lista do service worker`);
    }
  });
}

test('as letras do css estão na lista', () => {
  const urls = urlsDoCss('css/estilo.css');
  assert.ok(urls.length >= 6, 'o css devia pedir as letras');
  for (const url of urls) assert.ok(PRECACHE.includes(url), `${url} falta na lista do service worker`);
});

test('o service worker não mexe na API nem no tempo real', () => {
  assert.match(codigoSw, /startsWith\('\/api\/'\)/);
  assert.match(codigoSw, /startsWith\('\/hub\/'\)/);
  assert.match(codigoSw, /method !== 'GET'/);
});

test('o manifest está completo e os ícones existem', () => {
  const manifest = JSON.parse(ler('manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.name && manifest.short_name && manifest.start_url);
  const tamanhos = new Set();
  for (const icone of manifest.icons) {
    assert.ok(fs.existsSync(path.join(FRONTEND, icone.src)), `${icone.src} não existe`);
    tamanhos.add(icone.sizes);
  }
  assert.ok(tamanhos.has('192x192') && tamanhos.has('512x512'), 'o Chrome precisa de ícones de 192 e 512');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'), 'falta um ícone maskable');
  for (const pagina of fs.readdirSync(FRONTEND).filter((f) => f.endsWith('.html'))) {
    assert.match(ler(pagina), /<link rel="manifest" href="manifest.webmanifest">/, `${pagina} não liga o manifest`);
  }
});

test('a imagem do frontend leva o service worker, o manifest e os ícones', () => {
  const dockerfile = ler('Dockerfile');
  assert.match(dockerfile, /COPY sw\.js manifest\.webmanifest /);
  assert.match(dockerfile, /COPY icons\//);
});
