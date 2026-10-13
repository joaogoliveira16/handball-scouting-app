// Escudos (símbolos) das equipas: mostrar o escudo e preparar a imagem que o dono escolhe.
import { h } from './dom.js';

/** Tamanho máximo que a API aceita (tem de ser igual a Escudos.MaxBytes, em api/HandballScouting.Api/Escudos.cs). */
export const MAX_BYTES = 200 * 1024;
/** Lado do quadrado onde o escudo cabe (a imagem é reduzida a isto antes de seguir). */
export const LADO_ESCUDO = 256;
const LADOS_A_TENTAR = [LADO_ESCUDO, 160, 96];
const MAX_FICHEIRO = 15 * 1024 * 1024;

/** Endereço do escudo de uma equipa. A versão vai no endereço: quando o escudo muda, o browser vai buscar o novo. */
export const urlEscudo = (equipaId, versao) => `/api/equipas/${equipaId}/escudo?v=${versao}`;

/**
 * O escudo como imagem, ou null se a equipa não tem (a "versao" que a API devolve é null nesse caso).
 * "tamanho": 'pequeno' (listas), 'placar' (cabeçalho do jogo) ou 'grande' (página da equipa).
 */
export function escudo(equipaId, versao, tamanho = 'pequeno') {
  if (versao == null || equipaId == null) return null;
  return h('img', {
    class: `escudo escudo-${tamanho}`, src: urlEscudo(equipaId, versao), alt: '', 'aria-hidden': 'true',
    onerror: (e) => e.target.remove(),   // se a imagem não carregar, fica só o nome
  });
}

/** As letras do nome (até duas) para a equipa que ainda não tem escudo. */
export function iniciais(nome) {
  const palavras = String(nome).trim().split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p));
  return palavras.slice(0, 2).map((p) => [...p.replace(/[^\p{L}\p{N}]/gu, '')][0] ?? '').join('').toUpperCase();
}

function carregarImagem(url) {
  return new Promise((resolve, reject) => {
    const imagem = new Image();
    imagem.onload = () => resolve(imagem);
    imagem.onerror = () => reject(new Error('Não foi possível ler esta imagem. Experimenta um PNG, JPEG ou WebP.'));
    imagem.src = url;
  });
}

function paraBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Reduz a imagem escolhida a, no máximo, 256 px de lado (mantém a proporção e a transparência) e devolve-a como PNG,
 * pronta para enviar. Se mesmo assim passar dos 200 KB (uma fotografia, por exemplo), tenta lados mais pequenos.
 * Aceita PNG, JPEG, WebP e SVG; qualquer outra coisa dá erro.
 */
export async function prepararEscudo(ficheiro) {
  if (!ficheiro || !/^image\//.test(ficheiro.type)) throw new Error('Escolhe uma imagem (PNG, JPEG, WebP ou SVG).');
  if (ficheiro.size > MAX_FICHEIRO) throw new Error('Esta imagem é demasiado grande. Escolhe uma com menos de 15 MB.');

  const endereco = URL.createObjectURL(ficheiro);
  try {
    const imagem = await carregarImagem(endereco);
    const vetorial = ficheiro.type === 'image/svg+xml';
    // Um SVG sem tamanho próprio chega aqui com 0: nesse caso é um quadrado
    const largura = imagem.naturalWidth || LADO_ESCUDO;
    const altura = imagem.naturalHeight || LADO_ESCUDO;

    for (const lado of LADOS_A_TENTAR) {
      // Só se reduz; um SVG (vetorial) pode também ampliar até ao lado pretendido
      const escala = vetorial ? lado / Math.max(largura, altura) : Math.min(1, lado / Math.max(largura, altura));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(largura * escala));
      canvas.height = Math.max(1, Math.round(altura * escala));
      const contexto = canvas.getContext('2d');
      contexto.imageSmoothingQuality = 'high';
      contexto.drawImage(imagem, 0, 0, canvas.width, canvas.height);
      const blob = await paraBlob(canvas);
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    throw new Error('Não consegui reduzir esta imagem o suficiente. Escolhe um escudo mais simples.');
  } finally {
    URL.revokeObjectURL(endereco);
  }
}
