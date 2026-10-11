// Mapa do meio-campo de ataque (20 m x 20 m), baliza no topo.
// Coordenadas da app: x e y em percentagem (0 a 100). 1 % = 4 unidades SVG (campo de 400 x 400).
// x: 0 = esquerda de quem ataca, 100 = direita. y: 0 = linha de baliza, 100 = linha do meio-campo.

const NS = 'http://www.w3.org/2000/svg';
const ESCALA = 4;

// Mesmas cores neon do tema (css/estilo.css: --r-golo, --r-defesa...)
export const CORES = {
  GOLO: '#2cffa0', DEFESA: '#38bdf8', FORA: '#94a3b8', POSTE: '#ffb020', BLOQUEADO: '#c084fc',
};

const CONTORNO_MARCADOR = '#050914';
let contadorCampos = 0; // para os ids do SVG serem únicos se houver mais do que um campo na página

function svg(nome, atributos = {}, pai = null) {
  const el = document.createElementNS(NS, nome);
  for (const [chave, valor] of Object.entries(atributos)) el.setAttribute(chave, valor);
  if (pai) pai.append(el);
  return el;
}

/** Cria um elemento <svg> do campo (em páginas onde não está escrito no HTML). */
export function novoSvgCampo() {
  const el = svg('svg', { class: 'campo' });
  return el;
}

/** Desenha o símbolo de um resultado (formas diferentes além das cores, para se distinguir bem). */
export function desenharMarcador(pai, x, y, resultado, { raio = 7, titulo = null, halo = true } = {}) {
  const cx = x * ESCALA;
  const cy = y * ESCALA;
  const cor = CORES[resultado] ?? '#e8f1ff';
  const g = svg('g', { class: 'marcador' }, pai);
  // halo suave por baixo do símbolo (dá o brilho neon sem usar filtros pesados)
  if (halo) svg('circle', { cx, cy, r: raio + 5, fill: cor, class: 'marcador-halo' }, g);
  const base = { fill: cor, stroke: CONTORNO_MARCADOR, 'stroke-width': 1.5 };
  switch (resultado) {
    case 'DEFESA':
      svg('rect', { ...base, x: cx - raio, y: cy - raio, width: raio * 2, height: raio * 2 }, g);
      break;
    case 'FORA':
      svg('path', {
        d: `M${cx - raio} ${cy - raio}L${cx + raio} ${cy + raio}M${cx + raio} ${cy - raio}L${cx - raio} ${cy + raio}`,
        stroke: cor, 'stroke-width': 3.5, 'stroke-linecap': 'round', fill: 'none',
      }, g);
      break;
    case 'POSTE':
      svg('path', { ...base, d: `M${cx} ${cy - raio - 1}L${cx + raio + 1} ${cy + raio}L${cx - raio - 1} ${cy + raio}Z` }, g);
      break;
    case 'BLOQUEADO':
      svg('path', { ...base, d: `M${cx} ${cy - raio - 2}L${cx + raio + 2} ${cy}L${cx} ${cy + raio + 2}L${cx - raio - 2} ${cy}Z` }, g);
      break;
    default: // GOLO
      svg('circle', { ...base, cx, cy, r: raio }, g);
  }
  if (titulo) svg('title', {}, g).textContent = titulo;
  return g;
}

/** Símbolo pequeno para legendas (HTML), mesmo desenho do mapa. */
export function simboloLegenda(resultado) {
  const el = svg('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true' });
  const g = svg('g', {}, el);
  desenharMarcador(g, 2.5, 2.5, resultado, { raio: 6, halo: false });
  return el;
}

/**
 * Desenha o campo dentro de um <svg>. Se aoClicar for dado, chama-o com {x, y} (0-100)
 * quando se toca dentro do campo. Devolve funções para pôr marcadores e o ponto pendente.
 */
export function criarCampo(elemento, { aoClicar = null } = {}) {
  elemento.setAttribute('viewBox', '-10 -26 420 442');
  elemento.setAttribute('role', 'img');
  elemento.setAttribute('aria-label', 'Mapa do meio-campo de ataque');
  elemento.replaceChildren();

  const n = ++contadorCampos;
  const idRecorte = `recorte-campo-${n}`;
  const idGrelha = `grelha-campo-${n}`;

  const defs = svg('defs', {}, elemento);
  const recorte = svg('clipPath', { id: idRecorte }, defs);
  svg('rect', { x: 0, y: 0, width: 400, height: 400 }, recorte);
  // grelha de 1 m x 1 m (o campo tem 20 m, 400 unidades)
  const grelha = svg('pattern', { id: idGrelha, width: 20, height: 20, patternUnits: 'userSpaceOnUse' }, defs);
  svg('path', { d: 'M20 0H0V20', class: 'campo-grelha' }, grelha);

  svg('rect', { x: 0, y: 0, width: 400, height: 400, class: 'campo-chao' }, elemento);
  svg('rect', { x: 0, y: 0, width: 400, height: 400, fill: `url(#${idGrelha})` }, elemento);
  // Área de baliza (dentro dos 6 m)
  svg('path', { d: 'M50 0A120 120 0 0 0 170 120L230 120A120 120 0 0 0 350 0Z', class: 'campo-area' }, elemento);

  const linhas = svg('g', { class: 'campo-linhas', 'clip-path': `url(#${idRecorte})` }, elemento);
  svg('path', { d: 'M50 0A120 120 0 0 0 170 120L230 120A120 120 0 0 0 350 0', class: 'linha-6m' }, linhas);
  svg('path', {
    d: 'M-10 0A180 180 0 0 0 170 180L230 180A180 180 0 0 0 410 0',
    class: 'linha-9m', 'stroke-dasharray': '10 8',
  }, linhas);
  svg('line', { x1: 190, y1: 140, x2: 210, y2: 140, class: 'linha-7m' }, linhas);
  svg('line', { x1: 195, y1: 80, x2: 205, y2: 80, class: 'linha-4m' }, linhas);

  svg('rect', { x: 0, y: 0, width: 400, height: 400, fill: 'none', class: 'campo-contorno' }, elemento);
  svg('rect', { x: 170, y: -10, width: 60, height: 10, class: 'campo-baliza' }, elemento);

  svg('text', { x: 240, y: 112, class: 'campo-etiqueta' }, elemento).textContent = '6 m';
  svg('text', { x: 240, y: 172, class: 'campo-etiqueta' }, elemento).textContent = '9 m';
  svg('text', { x: 8, y: 392, class: 'campo-etiqueta' }, elemento).textContent = 'esquerda';
  svg('text', { x: 392, y: 392, class: 'campo-etiqueta', 'text-anchor': 'end' }, elemento).textContent = 'direita';

  const camadaMarcadores = svg('g', { class: 'camada-marcadores' }, elemento);
  const camadaPendente = svg('g', { class: 'camada-pendente' }, elemento);

  if (aoClicar) {
    elemento.addEventListener('click', (evento) => {
      const ponto = elemento.createSVGPoint();
      ponto.x = evento.clientX;
      ponto.y = evento.clientY;
      const p = ponto.matrixTransform(elemento.getScreenCTM().inverse());
      const x = p.x / ESCALA;
      const y = p.y / ESCALA;
      // pequena tolerância junto às linhas do campo; fora disso ignora
      if (x < -2 || x > 102 || y < -2 || y > 102) return;
      aoClicar({ x: arredondar(x), y: arredondar(y) });
    });
  }

  return {
    marcadores(lista) {
      camadaMarcadores.replaceChildren();
      for (const r of lista) {
        desenharMarcador(camadaMarcadores, Number(r.x), Number(r.y), r.resultado, {
          raio: 6,
          titulo: `#${r.jogadorNumero} · ${r.resultado}`,
        });
      }
    },
    pendente(ponto) {
      camadaPendente.replaceChildren();
      if (!ponto) return;
      const cx = ponto.x * ESCALA;
      const cy = ponto.y * ESCALA;
      svg('circle', { cx, cy, r: 13, class: 'pendente-onda' }, camadaPendente);
      svg('circle', { cx, cy, r: 13, class: 'pendente-anel' }, camadaPendente);
      svg('path', { d: `M${cx - 8} ${cy}H${cx + 8}M${cx} ${cy - 8}V${cy + 8}`, class: 'pendente-cruz' }, camadaPendente);
    },
  };
}

function arredondar(valor) {
  return Math.round(Math.min(100, Math.max(0, valor)) * 10) / 10;
}
