// O .github/dependabot.yml aponta para pastas que existem e que têm mesmo o que cada ecossistema lê. Um erro de
// escrita não dá aviso nenhum: o Dependabot limita-se a não atualizar nada.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const texto = fs.readFileSync(path.join(RAIZ, '.github/dependabot.yml'), 'utf8');

/** Os pares ecossistema + pasta (o ficheiro é simples: cada «- package-ecosystem:» é seguido de «directory:»). */
const entradas = [...texto.matchAll(/-\s+package-ecosystem:\s*(\S+)\s*\n\s+directory:\s*(\S+)/g)].map(([, ecossistema, pasta]) => ({ ecossistema, pasta }));

const FICHEIROS = {
  nuget: (d) => fs.readdirSync(d).some((f) => /\.(csproj|sln)$/.test(f)) || fs.readdirSync(d).some((f) => fs.existsSync(path.join(d, f)) && fs.statSync(path.join(d, f)).isDirectory() && fs.readdirSync(path.join(d, f)).some((g) => g.endsWith('.csproj'))),
  npm: (d) => fs.existsSync(path.join(d, 'package.json')),
  docker: (d) => fs.existsSync(path.join(d, 'Dockerfile')),
  'docker-compose': (d) => fs.existsSync(path.join(d, 'docker-compose.yml')),
  'github-actions': () => fs.existsSync(path.join(RAIZ, '.github/workflows/ci.yml')),
};

test('o Dependabot cobre a API, os testes, os Dockerfiles, o docker-compose e o CI', () => {
  const tem = (ecossistema, pasta) => entradas.some((e) => e.ecossistema === ecossistema && e.pasta === pasta);
  assert.ok(tem('nuget', '/api'), 'falta o nuget da API');
  assert.ok(tem('npm', '/tests'), 'falta o npm dos testes');
  assert.ok(tem('docker', '/api') && tem('docker', '/frontend'), 'falta o docker de um dos Dockerfiles');
  assert.ok(tem('docker-compose', '/'), 'falta o docker-compose');
  assert.ok(tem('github-actions', '/'), 'falta o github-actions');
});

test('cada entrada do Dependabot aponta para uma pasta com o que o ecossistema lê', () => {
  assert.ok(entradas.length >= 6);
  for (const { ecossistema, pasta } of entradas) {
    assert.ok(FICHEIROS[ecossistema], `ecossistema desconhecido: ${ecossistema}`);
    const diretorio = path.join(RAIZ, pasta);
    assert.ok(fs.existsSync(diretorio), `a pasta ${pasta} não existe`);
    assert.ok(FICHEIROS[ecossistema](diretorio), `${ecossistema}: a pasta ${pasta} não tem o que o ecossistema lê`);
  }
});

test('o CI verifica as vulnerabilidades das dependências', () => {
  const ci = fs.readFileSync(path.join(RAIZ, '.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /dotnet list [^\n]*package --vulnerable --include-transitive/);
  assert.match(ci, /npm audit --audit-level=high/);
});
