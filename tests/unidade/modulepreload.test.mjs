// Cada página pede logo no <head> todos os módulos JS de que precisa (<link rel="modulepreload">). Sem isso o browser
// só descobre um módulo depois de descarregar o que o importa, e numa rede lenta cada nível de imports custa mais uma
// ida e volta ao servidor. Se a lista ficar desatualizada (um import novo), a página funciona na mesma, mas mais
// devagar: por isso confere-se aqui que a lista de cada página é exatamente o que ela importa.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend');
const ler = (ficheiro) => fs.readFileSync(path.join(FRONTEND, ficheiro), 'utf8');

/** Todos os módulos que um módulo importa, e os que esses importam... (incluindo o próprio) */
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

const paginas = fs.readdirSync(FRONTEND).filter((f) => f.endsWith('.html'));

for (const pagina of paginas) {
  const html = ler(pagina);
  const modulo = /<script type="module" src="([^"]+)"><\/script>/.exec(html)?.[1];
  if (!modulo) continue;

  test(`${pagina}: o <head> pede todos os módulos que a página importa (modulepreload)`, () => {
    const pedidos = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
    assert.equal(new Set(pedidos).size, pedidos.length, 'módulo repetido na lista');
    assert.deepEqual([...pedidos].sort(), fecho(modulo).sort(),
      'a lista de <link rel="modulepreload"> não bate certo com os imports da página');
  });
}
