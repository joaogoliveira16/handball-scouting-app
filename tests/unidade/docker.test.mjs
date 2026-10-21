// A imagem do frontend tem de levar todas as páginas: uma página que só existe na pasta mas não na imagem dá 404
// em `docker compose up --build` (e passa despercebida nos testes, que servem a pasta diretamente).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend');
const dockerfile = fs.readFileSync(path.join(FRONTEND, 'Dockerfile'), 'utf8');
const instrucoesCopy = dockerfile.split('\n').filter((l) => /^\s*COPY\s/i.test(l));

test('a imagem do frontend leva todas as páginas html', () => {
  const copiaTodas = instrucoesCopy.some((l) => /\s\*\.html\s/.test(l));
  const paginas = fs.readdirSync(FRONTEND).filter((f) => f.endsWith('.html'));
  assert.ok(paginas.length > 0);
  for (const pagina of paginas) {
    assert.ok(copiaTodas || instrucoesCopy.some((l) => new RegExp(`\\s${pagina.replace('.', '\\.')}\\s`).test(l)), `o Dockerfile não copia ${pagina}`);
  }
});

test('a imagem do frontend leva as pastas e os ficheiros que as páginas usam', () => {
  for (const pasta of ['css', 'js', 'lib', 'fonts', 'icons']) {
    assert.ok(fs.existsSync(path.join(FRONTEND, pasta)), `a pasta ${pasta} existe`);
    assert.ok(instrucoesCopy.some((l) => l.includes(`${pasta}/`)), `o Dockerfile não copia ${pasta}/`);
  }
  assert.ok(instrucoesCopy.some((l) => /sw\.js/.test(l) && /manifest\.webmanifest/.test(l)), 'o Dockerfile não copia o sw.js e o manifest');
});
