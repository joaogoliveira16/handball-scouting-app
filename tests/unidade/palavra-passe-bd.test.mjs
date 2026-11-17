// A base de dados não pode nascer com a palavra-passe de fábrica (scripts/palavra-passe-bd.sh, usado pelo
// servidor.sh e pelo restaurar.sh). Testa-se com o bash a sério; num computador sem bash os testes saltam.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts');
const temBash = spawnSync('bash', ['-c', 'true']).status === 0;
const opcoes = { skip: temBash ? false : 'sem bash neste computador' };

function pastaTemporaria(env, { comScripts = [] } = {}) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-bd-'));
  fs.mkdirSync(path.join(pasta, 'scripts'));
  for (const nome of ['palavra-passe-bd.sh', ...comScripts]) fs.copyFileSync(path.join(SCRIPTS, nome), path.join(pasta, 'scripts', nome));
  if (env !== null) fs.writeFileSync(path.join(pasta, '.env'), env);
  return pasta;
}

/** Corre a função sobre um .env com este conteúdo (e, opcionalmente, POSTGRES_PASSWORD no ambiente). */
function verificar(env, ambiente = {}) {
  const pasta = pastaTemporaria(env);
  const { POSTGRES_PASSWORD, ...resto } = process.env;   // o ambiente de quem corre os testes não conta
  const r = spawnSync('bash', ['-c', '. scripts/palavra-passe-bd.sh; exigir_palavra_passe_forte .env'], { cwd: pasta, encoding: 'utf8', env: { ...resto, ...ambiente } });
  fs.rmSync(pasta, { recursive: true, force: true });
  return r;
}

const FORTE = 'a3f9c27e41b86d05e7c1';

test('recusa a palavra-passe de fábrica, a de exemplo e as curtas', opcoes, () => {
  for (const [env, parte] of [
    ['POSTGRES_PASSWORD=scouting\n', 'scouting'],
    ['POSTGRES_PASSWORD=muda-esta-palavra-passe\n', 'muda-esta-palavra-passe'],
    ['POSTGRES_PASSWORD=curta1\n', '6 caracteres'],
    ['POSTGRES_PASSWORD="scouting"\n', 'scouting'],
  ]) {
    const r = verificar(env);
    assert.equal(r.status, 1, env);
    assert.match(r.stderr, new RegExp(parte), env);
    assert.match(r.stderr, /openssl rand/, 'explica como gerar uma');
  }
});

test('recusa quando falta a palavra-passe (linha ausente, vazia, ou sem .env)', opcoes, () => {
  for (const env of ['PORTA_WEB=8080\n', 'POSTGRES_PASSWORD=\n', '# POSTGRES_PASSWORD=a3f9c27e41b86d05e7c1\n', null]) {
    const r = verificar(env);
    assert.equal(r.status, 1, String(env));
    assert.match(r.stderr, /não há POSTGRES_PASSWORD/);
  }
});

test('aceita uma palavra-passe forte, também com aspas, CRLF do Windows e linhas antes e depois', opcoes, () => {
  for (const env of [
    `POSTGRES_PASSWORD=${FORTE}\n`,
    `POSTGRES_PASSWORD="${FORTE}"\r\nPORTA_WEB=8080\r\n`,
    `PORTA_WEB=8080\n  POSTGRES_PASSWORD='${FORTE}'\nEMAIL_HOST=x\n`,
    `POSTGRES_PASSWORD=scouting\nPOSTGRES_PASSWORD=${FORTE}\n`,   // a última linha é a que vale
  ]) {
    const r = verificar(env);
    assert.equal(r.status, 0, `${JSON.stringify(env)}: ${r.stderr}`);
    assert.equal(r.stderr, '');
  }
});

test('a variável do ambiente tem prioridade sobre o .env (como no docker compose)', opcoes, () => {
  assert.equal(verificar('POSTGRES_PASSWORD=scouting\n', { POSTGRES_PASSWORD: FORTE }).status, 0);
  assert.equal(verificar(`POSTGRES_PASSWORD=${FORTE}\n`, { POSTGRES_PASSWORD: 'scouting' }).status, 1);
});

test('servidor.sh iniciar recusa sem chegar a tocar no Docker nem a abrir a porta', opcoes, () => {
  const pasta = pastaTemporaria('POSTGRES_PASSWORD=scouting\nPORTA_WEB=8080\n');
  const r = spawnSync('bash', [path.join(SCRIPTS, 'servidor.sh'), 'iniciar'], { encoding: 'utf8', env: { ...process.env, PASTA: pasta, PATH: '/nonexistent:/usr/bin:/bin' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /POSTGRES_PASSWORD é «scouting»/);
  assert.ok(!/INTERFACE_WEB/.test(fs.readFileSync(path.join(pasta, '.env'), 'utf8')), 'não devia ter mexido no .env');
  fs.rmSync(pasta, { recursive: true, force: true });
});

/** O restaurar.sh com um «docker» de mentira que regista o que lhe pedem; `volumes` é o que o `docker volume ls` devolve. */
function restaurar(env, volumes) {
  const pasta = pastaTemporaria(env, { comScripts: ['restaurar.sh'] });
  fs.mkdirSync(path.join(pasta, 'bin'));
  fs.writeFileSync(path.join(pasta, 'bin', 'docker'), `#!/bin/sh\necho "$@" >> "${pasta}/chamadas.txt"\n[ "$1" = volume ] && echo "${volumes}"\nexit 0\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(pasta, 'copia.dump'), 'x');
  const r = spawnSync('bash', [path.join(pasta, 'scripts', 'restaurar.sh'), path.join(pasta, 'copia.dump'), '--sim'], {
    encoding: 'utf8', env: { ...process.env, PATH: `${path.join(pasta, 'bin')}:${process.env.PATH}` },
  });
  const chamadas = fs.existsSync(path.join(pasta, 'chamadas.txt')) ? fs.readFileSync(path.join(pasta, 'chamadas.txt'), 'utf8') : '';
  fs.rmSync(pasta, { recursive: true, force: true });
  return { ...r, chamadas };
}

test('restaurar.sh não deixa nascer uma base de dados nova com palavra-passe fraca', opcoes, () => {
  const r = restaurar('POSTGRES_PASSWORD=scouting\n', '');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /POSTGRES_PASSWORD é «scouting»/);
  assert.ok(!/compose up/.test(r.chamadas), 'não devia ter criado a base de dados');
});

test('restaurar.sh arranca com palavra-passe forte, e numa base já criada não exige nada', opcoes, () => {
  const forte = restaurar(`POSTGRES_PASSWORD=${FORTE}\n`, '');
  assert.equal(forte.status, 0, forte.stderr);
  assert.match(forte.chamadas, /compose up -d db/);
  const jaExiste = restaurar('POSTGRES_PASSWORD=scouting\n', 'handball-scouting_dados_pg');   // o PC de desenvolvimento
  assert.equal(jaExiste.status, 0, jaExiste.stderr);
  assert.match(jaExiste.chamadas, /pg_restore --clean/);
});
