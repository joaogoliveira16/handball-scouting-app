// Baliza (3 m x 2 m) vista de frente, do lado de quem remata. Serve para marcar onde o guarda-redes
// defendeu a bola (banco) e para mostrar as defesas (dashboard).
// Coordenadas: x e y em percentagem (0 a 100). x: 0 = poste esquerdo de quem remata, 100 = poste direito.
// y: 0 = trave, 100 = chão.
import { desenharSimbolo } from './campo.js';
import { ORDEM_ZONA_BALIZA, ROTULO_ZONA_BALIZA, zonaBaliza } from './api.js';

const NS = 'http://www.w3.org/2000/svg';

// Geometria do SVG: a boca da baliza tem 300 x 200 unidades (1 % = 3 unidades na horizontal e 2 na vertical).
const X0 = 30;
const Y0 = 24;
const LARGURA = 300;
const ALTURA = 200;

function svg(nome, atributos = {}, pai = null) {
  const el = document.createElementNS(NS, nome);
  for (const [chave, valor] of Object.entries(atributos)) el.setAttribute(chave, valor);
  if (pai) pai.append(el);
  return el;
}

/** Cria um <svg> da baliza (para páginas onde não está escrito no HTML). */
export function novoSvgBaliza() {
  return svg('svg', { class: 'baliza' });
}

const paraSvg = (x, y) => ({ cx: X0 + (x / 100) * LARGURA, cy: Y0 + (y / 100) * ALTURA });

/**
 * Desenha a baliza dentro de um <svg>. Se aoClicar for dado, chama-o com {x, y, zona} (0-100)
 * quando se toca na baliza. Devolve funções para pôr marcadores e contagens por zona.
 */
export function criarBaliza(elemento, { aoClicar = null } = {}) {
  elemento.setAttribute('viewBox', '0 0 360 262');
  elemento.setAttribute('role', 'img');
  elemento.setAttribute('aria-label', 'Baliza vista de frente, do lado de quem remata');
  elemento.classList.toggle('interativa', Boolean(aoClicar));
  elemento.replaceChildren();

  // fundo e rede
  svg('rect', { x: X0, y: Y0, width: LARGURA, height: ALTURA, class: 'baliza-fundo' }, elemento);
  const rede = svg('g', { class: 'baliza-rede' }, elemento);
  for (let x = X0 + 15; x < X0 + LARGURA; x += 15) svg('line', { x1: x, y1: Y0, x2: x, y2: Y0 + ALTURA }, rede);
  for (let y = Y0 + 15; y < Y0 + ALTURA; y += 15) svg('line', { x1: X0, y1: y, x2: X0 + LARGURA, y2: y }, rede);

  // as 9 zonas (3 x 3); cada uma tem a sua célula para a contagem
  const zonas = svg('g', { class: 'baliza-zonas' }, elemento);
  const celulas = {};
  const textos = {};
  ORDEM_ZONA_BALIZA.forEach((zona, i) => {
    const coluna = i % 3;
    const linha = Math.floor(i / 3);
    const w = LARGURA / 3;
    const h = ALTURA / 3;
    celulas[zona] = svg('rect', {
      x: X0 + coluna * w, y: Y0 + linha * h, width: w, height: h, class: 'baliza-zona', 'data-zona': zona,
    }, zonas);
    textos[zona] = svg('text', {
      x: X0 + coluna * w + w / 2, y: Y0 + linha * h + h / 2, class: 'baliza-contagem',
    }, zonas);
  });

  // postes, trave e chão
  svg('rect', { x: X0 - 8, y: Y0 - 8, width: 8, height: ALTURA + 8, class: 'baliza-poste' }, elemento);
  svg('rect', { x: X0 + LARGURA, y: Y0 - 8, width: 8, height: ALTURA + 8, class: 'baliza-poste' }, elemento);
  svg('rect', { x: X0 - 8, y: Y0 - 8, width: LARGURA + 16, height: 8, class: 'baliza-poste' }, elemento);
  svg('line', { x1: 4, y1: Y0 + ALTURA + 1.5, x2: 356, y2: Y0 + ALTURA + 1.5, class: 'baliza-chao' }, elemento);

  svg('text', { x: X0, y: 255, class: 'baliza-etiqueta' }, elemento).textContent = 'esquerda';
  svg('text', { x: X0 + LARGURA, y: 255, class: 'baliza-etiqueta', 'text-anchor': 'end' }, elemento).textContent = 'direita';

  const camadaMarcadores = svg('g', { class: 'camada-marcadores' }, elemento);

  if (aoClicar) {
    elemento.addEventListener('click', (evento) => {
      const ponto = elemento.createSVGPoint();
      ponto.x = evento.clientX;
      ponto.y = evento.clientY;
      const p = ponto.matrixTransform(elemento.getScreenCTM().inverse());
      // um toque perto da baliza (nos postes, na trave ou no chão) conta como o limite mais próximo
      const x = limitar(((p.x - X0) / LARGURA) * 100);
      const y = limitar(((p.y - Y0) / ALTURA) * 100);
      aoClicar({ x, y, zona: zonaBaliza(x, y) });
    });
  }

  return {
    /** Pontos {balizaX, balizaY, jogadorNumero} de defesas. */
    marcadores(lista) {
      camadaMarcadores.replaceChildren();
      for (const r of lista) {
        if (r.balizaX == null || r.balizaY == null) continue;
        const { cx, cy } = paraSvg(Number(r.balizaX), Number(r.balizaY));
        const zona = r.balizaZona ?? zonaBaliza(Number(r.balizaX), Number(r.balizaY));
        desenharSimbolo(camadaMarcadores, cx, cy, 'DEFESA', {
          raio: 6, titulo: `#${r.jogadorNumero} · Defesa · ${ROTULO_ZONA_BALIZA[zona]}`,
        });
      }
    },
    /** Número de defesas por zona (objeto zona -> total); as zonas mais cheias ficam mais brilhantes. */
    contagens(porZona) {
      const maximo = Math.max(1, ...ORDEM_ZONA_BALIZA.map((z) => porZona[z] ?? 0));
      for (const zona of ORDEM_ZONA_BALIZA) {
        const n = porZona[zona] ?? 0;
        textos[zona].textContent = n > 0 ? String(n) : '';
        celulas[zona].style.fill = n > 0 ? `rgba(56, 189, 248, ${(0.08 + 0.4 * (n / maximo)).toFixed(2)})` : '';
      }
    },
  };
}

function limitar(valor) {
  return Math.round(Math.min(100, Math.max(0, valor)) * 10) / 10;
}
