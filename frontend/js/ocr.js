// Ler o texto de uma foto ou de um print, no próprio browser (Tesseract.js, em lib/tesseract/).
// Nada sai do dispositivo: a imagem não vai para a API nem para a internet. O leitor (cerca de 5 MB) só se carrega
// quando alguém pede uma leitura, e o browser guarda-o para as vezes seguintes.
import { contarCrescentes, lerLista } from './lista-jogadores.js';

const BASE = new URL('lib/tesseract/', document.baseURI).href;   // endereços absolutos: o worker corre num blob

/** Dá para correr o leitor neste browser? (precisa de WebAssembly com SIMD, que todos os browsers recentes têm) */
export function leituraDisponivel() {
  try {
    if (typeof Worker === 'undefined' || typeof WebAssembly !== 'object' || typeof createImageBitmap !== 'function') return false;
    // módulo mínimo com uma instrução SIMD (o teste da biblioteca wasm-feature-detect)
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

function carregarScript(url) {
  return new Promise((resolver, rejeitar) => {
    const el = document.createElement('script');
    el.src = url;
    el.onload = resolver;
    el.onerror = () => rejeitar(new Error('Não foi possível carregar o leitor de imagens.'));
    document.head.append(el);
  });
}

let avisarProgresso = () => {};
let promessaLeitor = null;

/** O leitor é criado uma vez e reutilizado até alguém o encerrar. */
function obterLeitor() {
  if (!promessaLeitor) {
    promessaLeitor = (async () => {
      if (typeof globalThis.Tesseract === 'undefined') await carregarScript(`${BASE}tesseract.min.js`);
      return globalThis.Tesseract.createWorker('por', globalThis.Tesseract.OEM.LSTM_ONLY, {
        workerPath: `${BASE}worker.min.js`,
        corePath: `${BASE}tesseract-core-simd-lstm.wasm.js`,
        langPath: BASE,
        gzip: true,
        logger: (m) => avisarProgresso(m),
      });
    })().catch((erro) => {
      promessaLeitor = null;
      throw erro;
    });
  }
  return promessaLeitor;
}

/** Liberta a memória do leitor (volta a carregar da próxima vez, o que é rápido porque o browser guarda os ficheiros). */
export async function encerrarLeitor() {
  const pendente = promessaLeitor;
  promessaLeitor = null;
  if (!pendente) return;
  try { await (await pendente).terminate(); } catch { /* já estava encerrado */ }
}

/**
 * A imagem pronta para ler: com a orientação da foto certa, num tamanho que o leitor aproveite (o lado maior fica
 * perto de `alvo` pixéis: as fotos grandes encolhem, os prints pequenos crescem até `ampliarAte` vezes; ampliar
 * demais estraga a leitura), em tons de cinza com o contraste esticado e, se for escura (modo escuro de um chat),
 * invertida. Com `limiar`, o fundo irregular (sombras, papel torto) é limpo por um limiar local.
 */
export async function prepararImagem(ficheiro, { limiar = false, alvo = 1600, ampliarAte = 1.5, contraste = true } = {}) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(ficheiro, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Não foi possível abrir esta imagem. Usa uma foto ou uma captura de ecrã em JPG ou PNG.');
  }
  const escala = Math.min(ampliarAte, alvo / Math.max(bitmap.width, bitmap.height));
  const largura = Math.max(1, Math.round(bitmap.width * escala));
  const altura = Math.max(1, Math.round(bitmap.height * escala));
  const tela = document.createElement('canvas');
  tela.width = largura;
  tela.height = altura;
  const ctx = tela.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, largura, altura);
  ctx.drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close?.();

  const imagem = ctx.getImageData(0, 0, largura, altura);
  const px = imagem.data;
  const cinza = new Uint8ClampedArray(largura * altura);
  const histograma = new Uint32Array(256);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    cinza[j] = g;
    histograma[g]++;
  }

  // Estica o contraste entre o percentil 1 e o 99; imagens escuras (letras claras) invertem-se
  const total = cinza.length;
  let baixo = 0; let alto = 255; let soma = 0;
  for (let acumulado = 0, v = 0; v < 256; v++) { acumulado += histograma[v]; if (acumulado >= total * 0.01) { baixo = v; break; } }
  for (let acumulado = 0, v = 255; v >= 0; v--) { acumulado += histograma[v]; if (acumulado >= total * 0.01) { alto = v; break; } }
  for (let v = 0; v < 256; v++) soma += v * histograma[v];
  const escuro = soma / total < 115;
  const intervalo = Math.max(1, alto - baixo);
  for (let j = 0; j < total; j++) {
    let v = contraste ? Math.min(255, Math.max(0, ((cinza[j] - baixo) * 255) / intervalo)) : cinza[j];
    if (escuro) v = 255 - v;
    cinza[j] = v;
  }

  let saida = cinza;
  if (limiar) saida = limiarLocal(cinza, largura, altura);

  for (let i = 0, j = 0; j < total; i += 4, j++) {
    px[i] = px[i + 1] = px[i + 2] = saida[j];
    px[i + 3] = 255;
  }
  ctx.putImageData(imagem, 0, 0);
  return tela;
}

/** Limiar local (Bradley): um ponto fica preto se for bem mais escuro do que a média à sua volta. */
function limiarLocal(cinza, largura, altura) {
  const integral = new Float64Array((largura + 1) * (altura + 1));
  for (let y = 0; y < altura; y++) {
    let linha = 0;
    for (let x = 0; x < largura; x++) {
      linha += cinza[y * largura + x];
      integral[(y + 1) * (largura + 1) + x + 1] = integral[y * (largura + 1) + x + 1] + linha;
    }
  }
  const meia = Math.max(8, Math.round(largura / 24));
  const saida = new Uint8ClampedArray(cinza.length);
  for (let y = 0; y < altura; y++) {
    const y1 = Math.max(0, y - meia); const y2 = Math.min(altura - 1, y + meia);
    for (let x = 0; x < largura; x++) {
      const x1 = Math.max(0, x - meia); const x2 = Math.min(largura - 1, x + meia);
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      const s = integral[(y2 + 1) * (largura + 1) + x2 + 1] - integral[y1 * (largura + 1) + x2 + 1]
        - integral[(y2 + 1) * (largura + 1) + x1] + integral[y1 * (largura + 1) + x1];
      saida[y * largura + x] = cinza[y * largura + x] * area < s * 0.85 ? 0 : 255;
    }
  }
  return saida;
}

/** Só para afinar a leitura: reconhece o texto de uma imagem já preparada com um modo de página. */
export async function reconhecer(tela, psm = '3') {
  const leitor = await obterLeitor();
  await leitor.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' });
  const { data } = await leitor.recognize(tela);
  return { texto: data.text, confianca: data.confidence };
}

/** Com tantos jogadores em ordem crescente de número, a leitura está boa (uma convocatória tem 12 a 16). */
const JOGADORES_SUFICIENTES = 12;

/** Duas tentativas fazem-se sempre: a primeira pode chegar ao número de jogadores mas juntar palavras ("Tiagoreis"). */
const TENTATIVAS_MINIMAS = 2;

/**
 * As tentativas por ordem. O tamanho da imagem é o que mais pesa (o texto tem de ficar nem pequeno nem enorme) e
 * depende da foto, por isso variam-no; só param quando uma tentativa chega, e fica a melhor de todas.
 */
const TENTATIVAS = [
  { alvo: 1600, limiar: false, psm: '3' },    // o modo 3 deteta sozinho tabelas e colunas
  { alvo: 1100, limiar: false, psm: '3' },    // letra mais pequena (prints largos, tabelas com muito espaço)
  { alvo: 1600, limiar: true, psm: '3' },     // fundo limpo por limiar local (sombras, papel torto)
  { alvo: 2200, limiar: false, psm: '3' },    // letra miúda numa foto de baixa resolução
  { alvo: 1600, limiar: false, psm: '6' },    // um único bloco de texto
  { alvo: 1600, limiar: false, psm: '11' },   // texto solto
];

/**
 * Lê uma imagem e devolve o texto e os jogadores da melhor tentativa (mais jogadores com números por ordem,
 * depois maior confiança do leitor).
 * `aoProgresso({ fase, progresso, tentativa, total })`: fase "carregar" (só na primeira vez) ou "ler".
 */
export async function lerImagem(ficheiro, { aoProgresso = () => {} } = {}) {
  let tentativaAtual = 1;
  avisarProgresso = (m) => {
    if (m.status === 'recognizing text') aoProgresso({ fase: 'ler', progresso: m.progress, tentativa: tentativaAtual, total: TENTATIVAS.length });
    else aoProgresso({ fase: 'carregar', progresso: m.progress ?? 0, tentativa: tentativaAtual, total: TENTATIVAS.length });
  };

  aoProgresso({ fase: 'carregar', progresso: 0, tentativa: 1, total: TENTATIVAS.length });
  const leitor = await obterLeitor();

  let melhor = { texto: '', jogadores: [], pontos: -1 };
  const imagens = new Map();   // cada versão da imagem prepara-se uma vez
  try {
    for (const [i, { alvo, limiar, psm }] of TENTATIVAS.entries()) {
      tentativaAtual = i + 1;
      const chave = `${alvo}/${limiar}`;
      if (!imagens.has(chave)) imagens.set(chave, await prepararImagem(ficheiro, { alvo, limiar }));
      await leitor.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' });
      aoProgresso({ fase: 'ler', progresso: 0, tentativa: tentativaAtual, total: TENTATIVAS.length });
      const { data } = await leitor.recognize(imagens.get(chave));
      const jogadores = lerLista(data.text);
      const pontos = contarCrescentes(jogadores) * 1000 + Math.round(data.confidence);
      if (pontos > melhor.pontos) melhor = { texto: data.text, jogadores, pontos };
      if (i + 1 >= TENTATIVAS_MINIMAS && contarCrescentes(melhor.jogadores) >= JOGADORES_SUFICIENTES) break;
    }
  } finally {
    for (const tela of imagens.values()) { tela.width = 0; tela.height = 0; }   // liberta a memória das imagens
  }
  return { texto: melhor.texto, jogadores: melhor.jogadores };
}
