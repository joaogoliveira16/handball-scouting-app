// Do texto lido numa foto (OCR) para uma lista de jogadores: número, nome e posição.
// Só trabalha com texto (sem DOM), por isso testa-se com `node --test` (tests/unidade).
//
// Formatos que entende, uma linha por jogador:
//   "7 João Silva"   "7 - João Silva (GR)"   "#7 JOÃO SILVA GR"   "Nº 7 | JOÃO SILVA | 123456"   "João Silva 7"

const POSICOES_CODIGOS = ['GR', 'PE', 'LE', 'CE', 'LD', 'PD', 'PV'];

/** Palavras que, sozinhas, não são nome de ninguém (cabeçalhos e rodapés das fichas de jogo). */
const NAO_SAO_NOMES = new Set([
  'parte', 'partes', 'jornada', 'fase', 'jogo', 'jogos', 'total', 'nome', 'nomes', 'equipa', 'equipas', 'treinador', 'treinadores',
  'delegado', 'arbitro', 'arbitros', 'oficial', 'oficiais', 'lic', 'licenca', 'licencas', 'numero', 'jogador', 'jogadores',
  'convocados', 'convocatoria', 'suplentes', 'titulares', 'minuto', 'minutos', 'golos', 'pontos', 'data', 'hora', 'local',
]);

/** Partículas dos nomes portugueses que ficam em minúsculas (menos no início). */
const PARTICULAS = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'di', 'del', 'van', 'von']);

const SEM_ACENTOS = (texto) => texto.normalize('NFD').replace(/\p{M}/gu, '');

/** Posição que vem escrita na linha (códigos em maiúsculas ou palavras), e o texto sem ela. */
function tirarPosicao(texto) {
  const palavras = [
    [/guarda[\s-]*redes/i, 'GR'],
    [/ponta[\s-]*esquerda/i, 'PE'],
    [/ponta[\s-]*direita/i, 'PD'],
    [/lateral[\s-]*esquerdo/i, 'LE'],
    [/lateral[\s-]*direito/i, 'LD'],
    [/\bpiv[oô]\b/i, 'PV'],
    [/\bcentral\b/i, 'CE'],
  ];
  for (const [regex, codigo] of palavras) {
    if (regex.test(texto)) return { posicao: codigo, texto: texto.replace(regex, ' ') };
  }
  // Códigos: só em maiúsculas e sozinhos (ou entre parênteses), para não confundir com partes de nomes
  const codigo = /(?:^|[\s(\[\-–—/,;])((?:G\.?R|P\.?E|L\.?E|C\.?E|L\.?D|P\.?D|P\.?V))\.?(?=$|[\s)\]\-–—/,;])/.exec(texto);
  if (codigo) {
    const sigla = codigo[1].replace(/\./g, '');
    if (POSICOES_CODIGOS.includes(sigla)) {
      return { posicao: sigla, texto: texto.slice(0, codigo.index) + ' ' + texto.slice(codigo.index + codigo[0].length) };
    }
  }
  return { posicao: null, texto };
}

/** 1 a 99 a partir do que o OCR leu (confunde O com 0 e I/l com 1). Devolve null se não for um número de camisola. */
function numeroDe(token) {
  if (!/\d/.test(token)) return null;
  const valor = Number(token.replace(/[Oo]/g, '0').replace(/[Il]/g, '1'));
  return valor >= 1 && valor <= 99 ? valor : null;
}

/** "RUI MESQUITA" / "RUi Mesquita" -> "Rui Mesquita"; mantém "McDonald" e iniciais ("A. Santos"). */
export function arranjarNome(nome) {
  return nome.split(/\s+/).filter(Boolean).map((palavra, i) => {
    let p = palavra;
    const maiusculas = p.length > 1 && p === p.toUpperCase() && p !== p.toLowerCase();
    const arranhado = /^[A-ZÀ-ÝÇ]{2,}[a-zà-ÿç]/.test(p);   // "RUi": o OCR trocou as primeiras letras
    if (maiusculas || arranhado) p = p.toLowerCase();
    if (i > 0 && PARTICULAS.has(p.toLowerCase())) return p.toLowerCase();
    // Maiúscula no início e depois de hífen ("João-Pedro")
    return p.replace(/(^|-)(\p{L})/gu, (_, antes, letra) => antes + letra.toLocaleUpperCase('pt-PT'));
  }).join(' ');
}

/** Uma linha de texto -> { numero, nome, posicao } ou null se a linha não parece ser um jogador. */
export function lerLinha(linhaBruta) {
  let linha = String(linhaBruta ?? '').normalize('NFC').replace(/[|¦\t]/g, ' ').replace(/\s+/g, ' ').trim();
  if (linha.length < 3 || !/\p{L}{2}/u.test(linha)) return null;
  // Horas, datas e partes do jogo ("1ª parte", "12:30", "05/10/2026") não são jogadores
  if (/\d{1,2}\s*[:h]\s*\d{2}\b|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/.test(linha)) return null;

  let numero = null;
  let resto = linha;

  // Número no início, com o lixo que o OCR põe antes do "#" ou do "N.º"
  const inicio = /^[\s*#$+.\-–—•·:;,'"‘’“”()\[\]{}<>_=~^%&@!?/\\tTfF]{0,3}?(?:n\s*[.º°o]{0,2}\s*)?([0-9OoIl]{1,2})(?![0-9A-Za-zÀ-ÿªº])\s*[.)\]:\-–—,;]*\s*/i.exec(linha);
  if (inicio && numeroDe(inicio[1]) !== null) {
    numero = numeroDe(inicio[1]);
    resto = linha.slice(inicio[0].length);
  } else {
    // Número no fim ("João Silva 7")
    const fim = /\s[#nº°.]*([0-9]{1,2})\s*$/.exec(linha.replace(/\b\d{3,}\b/g, ' ').trim());
    if (fim && numeroDe(fim[1]) !== null) {
      numero = numeroDe(fim[1]);
      resto = linha.replace(/\b\d{3,}\b/g, ' ').trim().slice(0, fim.index);
    }
  }
  if (numero === null) return null;

  resto = resto.replace(/\b\d+\b/g, ' ');   // números de licença e outros que sobrem
  const { posicao, texto } = tirarPosicao(resto);
  const nome = arranjarNome(
    texto
      .replace(/[^\p{L}\s'’.\-]/gu, ' ')   // fica só o que pode estar num nome
      .replace(/(^|\s)[.\-'’]+(?=\s|$)/g, ' ')   // pontuação solta
      .replace(/\s+/g, ' ')
      .replace(/^[.\-'’\s]+|[-'’\s]+$/g, '')
      .trim());

  const letras = (nome.match(/\p{L}/gu) ?? []).length;
  if (letras < 3) return null;
  const palavras = SEM_ACENTOS(nome).toLowerCase().replace(/[.\-']/g, ' ').split(/\s+/).filter(Boolean);
  if (palavras.every((p) => NAO_SAO_NOMES.has(p)) || palavras.some((p) => ['convocatoria', 'ficha', 'treinador', 'delegado'].includes(p))) return null;
  return { numero, nome: nome.slice(0, 80), posicao };
}

/**
 * O texto inteiro -> lista de jogadores, pela ordem em que aparecem. Cada um traz `linha` (o texto de onde saiu)
 * e `repetido` se o número já tinha aparecido antes (o ecrã deixa a pessoa escolher).
 */
export function lerLista(texto) {
  const jogadores = [];
  const vistos = new Set();
  for (const linha of String(texto ?? '').split(/\r?\n/)) {
    const jogador = lerLinha(linha);
    if (!jogador) continue;
    jogadores.push({ ...jogador, linha: linha.trim(), repetido: vistos.has(jogador.numero) });
    vistos.add(jogador.numero);
  }
  return jogadores;
}

/**
 * Quantos jogadores vêm com o número maior do que o do anterior. Numa ficha lida a direito os números sobem
 * (1, 3, 5, 7...), por isso é a melhor pista de que a leitura não baralhou linhas nem leu lixo como jogadores.
 */
export function contarCrescentes(jogadores) {
  return jogadores.filter((j, i) => i === 0 || j.numero > jogadores[i - 1].numero).length;
}

/** Os nomes parecem ser da mesma pessoa? (ignora maiúsculas e acentos; basta uma palavra grande em comum) */
export function nomesParecidos(a, b) {
  const palavras = (n) => SEM_ACENTOS(n).toLowerCase().split(/[^a-z]+/).filter((p) => p.length >= 3 && !PARTICULAS.has(p));
  const pa = palavras(a);
  const pb = new Set(palavras(b));
  return pa.some((p) => pb.has(p));
}
