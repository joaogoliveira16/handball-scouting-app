// A página de privacidade existe, não depende de scripts, está ligada à página de entrada e diz o que a app faz.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend');
const ler = (nome) => fs.readFileSync(path.join(FRONTEND, nome), 'utf8');
const pagina = ler('privacidade.html');

test('a página de privacidade é só texto: sem scripts', () => {
  assert.ok(!/<script/i.test(pagina));
  assert.match(pagina, /<html lang="pt-PT">/);
  assert.match(pagina, /<h1>Política de privacidade<\/h1>/);
});

test('a página de entrada liga à política, no registo e no fim', () => {
  const entrar = ler('entrar.html');
  const formRegisto = /<form id="form-registo"[\s\S]*?<\/form>/.exec(entrar)?.[0] ?? '';
  assert.match(formRegisto, /href="privacidade\.html"/, 'o formulário de registo não liga à política');
  assert.ok((entrar.match(/href="privacidade\.html"/g) ?? []).length >= 2, 'falta a ligação no fim da página');
});

test('a política diz o que a app guarda de facto', () => {
  const texto = pagina.replace(/<[^>]+>/g, ' ');
  for (const frase of ['PBKDF2', 'cookie', '30 dias', '24 horas', 'Cloudflare', 'convidado', 'Comissão Nacional de Proteção de Dados', 'apagá-los', 'menores']) {
    assert.ok(texto.includes(frase), `a política não fala de «${frase}»`);
  }
});

test('o email de contacto de quem põe a app no ar', (t) => {
  // O email não pode ser o de ninguém por engano: a página leva um marcador, sempre o mesmo, a trocar antes de abrir ao público.
  const marcador = 'PREENCHER-EMAIL-DE-CONTACTO';
  const mailtos = [...pagina.matchAll(/href="mailto:([^"]*)"/g)].map((m) => m[1]);
  assert.ok(mailtos.length >= 2, 'a política devia ter o contacto em dois sítios');
  assert.equal(new Set(mailtos).size, 1, 'os dois contactos têm de ser o mesmo');
  const [email] = mailtos;
  assert.ok(email === marcador || /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email), `email inválido: ${email}`);
  assert.ok(!/joaogoliveira16@gmail\.com/i.test(pagina), 'o email pessoal não vai para uma página pública');
  if (email === marcador) t.diagnostic(`falta trocar ${marcador} em frontend/privacidade.html pelo email de contacto`);
});
