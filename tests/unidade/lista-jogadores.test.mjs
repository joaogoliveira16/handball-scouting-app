// Testes do leitor de listas de jogadores (frontend/js/lista-jogadores.js): texto que o OCR devolve -> jogadores.
//   node --no-warnings --test unidade/
import assert from 'node:assert/strict';
import test from 'node:test';
import { arranjarNome, contarCrescentes, lerLinha, lerLista, nomesParecidos } from '../../frontend/js/lista-jogadores.js';

// Texto lido de verdade pelo Tesseract em imagens de teste (tabela de ficha de jogo, mensagem de chat, lista com maiúsculas trocadas)
const TABELA = `FICHA DE JOGO — CONVOCATÓRIA

Equipa: LEÕES DO SUL

Nº                 NOME                   LIC.

1     RUI MESQUITA (GR)         120000
3      TIAGO REIS                      120037
5      JOEL MOTA                      120074
10 | JOÃO PEREIRA               120222
14 | GONÇALO MOREIRA         120333
77 | SÉRGIO NUNES DA SILVA | 120518
99 | LUÍS AZEVEDO (GR)             120555

Treinador: A. Santos — Delegado: M. Silva
`;

const CHAT = `Convocatória sábado

t1 RUI MESQUITA GR

*f3 TIAGO REIS

*t5 JOEL MOTA
t10 JOÃO PEREIRA

*t13 FRANCISCO LOPES
t77 SÉRGIO NUNES DA SILVA
t99 LUÍS AZEVEDO GR
`;

const resumo = (jogadores) => jogadores.map((j) => `${j.numero}|${j.nome}|${j.posicao ?? ''}`);

test('tabela de ficha de jogo: número, nome e (GR), sem licenças nem cabeçalhos', () => {
  assert.deepEqual(resumo(lerLista(TABELA)), [
    '1|Rui Mesquita|GR', '3|Tiago Reis|', '5|Joel Mota|', '10|João Pereira|', '14|Gonçalo Moreira|', '77|Sérgio Nunes da Silva|', '99|Luís Azevedo|GR',
  ]);
});

test('mensagem de chat com «#»: o lixo que o OCR põe antes do número não atrapalha', () => {
  assert.deepEqual(resumo(lerLista(CHAT)), [
    '1|Rui Mesquita|GR', '3|Tiago Reis|', '5|Joel Mota|', '10|João Pereira|', '13|Francisco Lopes|', '77|Sérgio Nunes da Silva|', '99|Luís Azevedo|GR',
  ]);
});

test('formatos de uma linha', () => {
  const casos = {
    '7 João Silva': [7, 'João Silva', null],
    '7. João Silva': [7, 'João Silva', null],
    '7 - João Silva (GR)': [7, 'João Silva', 'GR'],
    '#7 JOÃO SILVA GR': [7, 'João Silva', 'GR'],
    'Nº 7 | JOÃO SILVA | 123456': [7, 'João Silva', null],
    'N.º 12 Pedro da Costa': [12, 'Pedro da Costa', null],
    'João Silva 7': [7, 'João Silva', null],
    '09 JOÃO-PEDRO SILVA (PV)': [9, 'João-Pedro Silva', 'PV'],
    '8 Miguel Santos - Ponta Esquerda': [8, 'Miguel Santos', 'PE'],
    '4 Rui Lopes Guarda-Redes': [4, 'Rui Lopes', 'GR'],
    '6 A. Santos': [6, 'A. Santos', null],
    '11 RUi Mesquita': [11, 'Rui Mesquita', null],
    '1O Ricardo Alves': [10, 'Ricardo Alves', null],   // o OCR leu um «O» em vez de «0»
    'l7 Hugo Teixeira': [17, 'Hugo Teixeira', null],    // e um «l» em vez de «1»
  };
  for (const [linha, [numero, nome, posicao]] of Object.entries(casos)) {
    assert.deepEqual(lerLinha(linha) && { n: lerLinha(linha).numero, nome: lerLinha(linha).nome, p: lerLinha(linha).posicao }, { n: numero, nome, p: posicao }, linha);
  }
});

test('linhas que não são jogadores ficam de fora', () => {
  for (const linha of ['', '   ', 'Nº NOME LIC.', 'FICHA DE JOGO — CONVOCATÓRIA', 'Equipa: LEÕES DO SUL', 'Treinador: A. Santos', '1ª Parte 12:30',
    'Jornada 5', '05/10/2026 Pavilhão Municipal', '123456', '7', '100 Rui Costa', '0 Rui Costa', 'Jogo 12 Total', 'Delegado: M. Silva 3']) {
    assert.equal(lerLinha(linha), null, `«${linha}» não devia ser um jogador`);
  }
});

test('números repetidos ficam marcados', () => {
  const lista = lerLista('7 Rui Costa\n8 Pedro Sousa\n7 Tiago Reis');
  assert.deepEqual(lista.map((j) => j.repetido), [false, false, true]);
  assert.equal(lista[2].linha, '7 Tiago Reis');
});

test('os nomes ficam com maiúsculas certas e as partículas em minúsculas', () => {
  assert.equal(arranjarNome('SÉRGIO NUNES DA SILVA'), 'Sérgio Nunes da Silva');
  assert.equal(arranjarNome('rui   mesquita'), 'Rui Mesquita');
  assert.equal(arranjarNome('RUi MESQUITA'), 'Rui Mesquita');
  assert.equal(arranjarNome('Maria De Jesus'), 'Maria de Jesus');
  assert.equal(arranjarNome('A. SANTOS'), 'A. Santos');
  assert.equal(arranjarNome('McDonald'), 'McDonald');
});

test('um nome nunca passa de 80 caracteres', () => {
  const grande = lerLinha(`7 ${'Abcdefghij '.repeat(12)}`);
  assert.ok(grande.nome.length <= 80);
});

test('nomesParecidos ignora maiúsculas e acentos e pede uma palavra em comum', () => {
  assert.equal(nomesParecidos('João Pereira', 'JOAO PEREIRA'), true);
  assert.equal(nomesParecidos('Rui Mesquita', 'Mesquita, Rui'), true);
  assert.equal(nomesParecidos('Rui Mesquita', 'Tiago Reis'), false);
  assert.equal(nomesParecidos('Pedro da Costa', 'Rui da Silva'), false);   // «da» não conta
});

test('contarCrescentes conta os jogadores cujo número sobe em relação ao anterior', () => {
  assert.equal(contarCrescentes([]), 0);
  assert.equal(contarCrescentes(lerLista('1 Rui Mesquita\n3 Tiago Reis\n5 Joel Mota')), 3);
  // lixo lido como jogador (número fora de ordem) não conta
  assert.equal(contarCrescentes(lerLista('7 André Ferreira\n3 Tiago Reis\n8 Pedro Sousa')), 2);
});
