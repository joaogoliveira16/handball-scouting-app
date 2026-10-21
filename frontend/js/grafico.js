// Gráfico de linhas (um valor por jogo): uma ou duas séries, legenda, cruz e dica ao passar o rato (ou com as setas),
// valor no último jogo e uma vista em tabela com os mesmos números. As contas estão em grafico-calculos.js.
import { h } from './dom.js';
import { eixoY, posicoesX, maisProximo, rotulosVisiveis, trocos, formatarValor } from './grafico-calculos.js';

const NS = 'http://www.w3.org/2000/svg';
const ALTURA = 240;
const MARGEM = { cima: 16, direita: 52, baixo: 44, esquerda: 40 };
const RAIO_PONTO = 4.5;

function svg(nome, atributos = {}, pai = null) {
  const el = document.createElementNS(NS, nome);
  for (const [chave, valor] of Object.entries(atributos)) el.setAttribute(chave, valor);
  if (pai) pai.append(el);
  return el;
}

/**
 * @param {object} o
 * @param {string} o.id identificador do elemento (para os testes e as ligações)
 * @param {string} o.titulo o que o gráfico mostra (uma frase)
 * @param {{curto: string, longo: string}[]} o.categorias um item por jogo: o rótulo do eixo e o texto da dica
 * @param {{nome: string, cor: string, valores: (number|null)[]}[]} o.series uma ou duas séries (a cor é um valor CSS, ex. var(--serie-1))
 * @param {'inteiro'|'percentagem'|'decimal'} [o.formato]
 * @param {number|null} [o.maximoFixo] eixo vertical fixo (100 nas percentagens)
 */
export function graficoLinhas({ id, titulo, categorias, series, formato = 'inteiro', maximoFixo = null }) {
  const n = categorias.length;
  let ativo = -1;            // o jogo em foco (dica aberta)
  let larguraAtual = 0;
  let geometria = null;      // { x: posições, y: (valor) => px, area }

  const dica = h('div', { class: 'grafico-dica', role: 'status', hidden: true });
  const area = h('div', { class: 'grafico-area' });
  const legenda = series.length >= 2
    ? h('ul', { class: 'grafico-legenda', 'aria-label': 'Legenda' },
      series.map((s) => h('li', {}, h('span', { class: 'chave-linha', style: `background:${s.cor}` }), s.nome)))
    : null;

  // A vista em tabela: os mesmos números, para quem não vê as cores nem usa o rato
  const tabela = h('div', { class: 'tabela-rolagem grafico-tabela', hidden: true },
    h('table', { class: 'tabela' },
      h('caption', { class: 'so-leitor' }, titulo),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Jogo'), series.map((s) => h('th', { class: 'num', scope: 'col' }, s.nome)))),
      h('tbody', {}, categorias.map((c, i) => h('tr', {},
        h('td', {}, c.longo),
        series.map((s) => h('td', { class: 'num' }, formatarValor(formato, s.valores[i]))))))));

  const botaoTabela = h('button', {
    type: 'button', class: 'botao suave pequeno grafico-alternar', 'aria-pressed': 'false',
    onclick: () => {
      const verTabela = tabela.hidden;
      tabela.hidden = !verTabela;
      area.hidden = verTabela;
      legenda && (legenda.hidden = verTabela);
      botaoTabela.setAttribute('aria-pressed', verTabela ? 'true' : 'false');
      botaoTabela.textContent = verTabela ? 'Ver gráfico' : 'Ver como tabela';
      if (!verTabela) desenhar(true);
    },
  }, 'Ver como tabela');

  const raiz = h('figure', { class: 'grafico', id },
    h('figcaption', { class: 'grafico-titulo' }, titulo),
    legenda, area, tabela,
    h('div', { class: 'grafico-rodape' }, botaoTabela));

  // -------------------------------------------------------------------
  function mostrarDica(i) {
    if (!geometria || i < 0 || i >= n) return esconderDica();
    ativo = i;
    const g = geometria;
    g.cruz.setAttribute('x1', g.x[i]);
    g.cruz.setAttribute('x2', g.x[i]);
    g.cruz.style.display = '';
    g.pontos.forEach((ponto, k) => ponto.setAttribute('r', k === i ? RAIO_PONTO + 1.5 : RAIO_PONTO));

    dica.replaceChildren(
      h('div', { class: 'dica-titulo' }, categorias[i].longo),
      ...series.map((s) => h('div', { class: 'dica-linha' },
        h('span', { class: 'chave-linha', style: `background:${s.cor}` }),
        h('strong', {}, formatarValor(formato, s.valores[i])),
        h('span', { class: 'dica-nome' }, s.nome))));
    dica.hidden = false;
    // à direita do ponto, ou à esquerda se não couber
    const meio = g.x[i];
    const largura = dica.offsetWidth;
    const aDireita = meio + 14 + largura <= larguraAtual;
    dica.style.left = `${aDireita ? meio + 14 : Math.max(0, meio - 14 - largura)}px`;
    dica.style.top = `${MARGEM.cima}px`;
  }

  function esconderDica() {
    ativo = -1;
    dica.hidden = true;
    if (geometria) {
      geometria.cruz.style.display = 'none';
      geometria.pontos.forEach((ponto) => ponto.setAttribute('r', RAIO_PONTO));
    }
  }

  function desenhar(forcar = false) {
    const largura = Math.round(area.clientWidth);
    if (!largura || (!forcar && Math.abs(largura - larguraAtual) < 2 && geometria)) return;
    larguraAtual = largura;
    const w = Math.max(260, largura);
    const caixa = { x0: MARGEM.esquerda, x1: w - MARGEM.direita, y0: MARGEM.cima, y1: ALTURA - MARGEM.baixo };

    const todos = series.flatMap((s) => s.valores).filter((v) => v != null).map(Number);
    const eixo = eixoY(todos.length ? Math.max(...todos) : 0, { fixo: maximoFixo, inteiros: formato === 'inteiro' });
    const y = (valor) => caixa.y1 - (valor / eixo.max) * (caixa.y1 - caixa.y0);
    const x = posicoesX(n, caixa.x0, caixa.x1);

    const grafico = svg('svg', {
      class: 'grafico-svg', width: w, height: ALTURA, viewBox: `0 0 ${w} ${ALTURA}`, role: 'img', tabindex: 0,
      'aria-label': `${titulo}. Usa as setas para percorrer os jogos.`,
    });

    // grelha e eixo vertical: fios finos e discretos
    const grelha = svg('g', { class: 'grafico-grelha' }, grafico);
    for (const t of eixo.ticks) {
      svg('line', { x1: caixa.x0, x2: caixa.x1, y1: y(t), y2: y(t), class: t === 0 ? 'base' : '' }, grelha);
      svg('text', { x: caixa.x0 - 8, y: y(t), class: 'eixo-y', 'text-anchor': 'end', 'dominant-baseline': 'central' }, grelha)
        .textContent = formato === 'percentagem' ? `${t}%` : formatarValor('inteiro', t);
    }

    // eixo horizontal: a data e, por baixo, o adversário (só os rótulos que cabem)
    const faixa = n ? (caixa.x1 - caixa.x0) / n : 1;
    const visiveis = rotulosVisiveis(n, faixa, 46);
    const rotulosX = svg('g', { class: 'grafico-eixo-x' }, grafico);
    categorias.forEach((c, i) => {
      if (!visiveis.has(i)) return;
      const texto = svg('text', { x: x[i], y: caixa.y1 + 18, 'text-anchor': 'middle' }, rotulosX);
      texto.textContent = c.curto;
      if (c.curto2) svg('text', { x: x[i], y: caixa.y1 + 33, 'text-anchor': 'middle', class: 'segunda-linha' }, rotulosX).textContent = c.curto2;
    });

    const cruz = svg('line', { y1: caixa.y0, y2: caixa.y1, class: 'grafico-cruz', style: 'display:none' }, grafico);

    // as linhas (2 px) por baixo dos pontos (r 4,5 com anel da cor da superfície); o valor do último jogo ao lado
    const pontos = [];
    const etiquetas = [];
    series.forEach((s, k) => {
      const camada = svg('g', { class: 'grafico-serie', 'data-serie': k }, grafico);
      for (const troco of trocos(s.valores)) {
        if (troco.length < 2) continue;
        svg('path', {
          d: troco.map((p, j) => `${j ? 'L' : 'M'}${x[p.i].toFixed(1)} ${y(p.valor).toFixed(1)}`).join(''),
          class: 'grafico-linha', stroke: s.cor,
        }, camada);
      }
      s.valores.forEach((valor, i) => {
        if (valor == null) return;
        const ponto = svg('circle', { cx: x[i], cy: y(Number(valor)), r: RAIO_PONTO, class: 'grafico-ponto', fill: s.cor, 'data-i': i }, camada);
        (pontos[i] ??= []).push(ponto);
      });
      const ultimo = s.valores.reduce((u, v, i) => (v == null ? u : i), -1);
      if (ultimo >= 0) etiquetas.push({ k, i: ultimo, py: y(Number(s.valores[ultimo])), texto: formatarValor(formato, s.valores[ultimo]) });
    });
    // o valor do último jogo; se duas etiquetas se tocam, fica só a da primeira série (a dica e a tabela têm os dois)
    let anteriorY = -Infinity;
    for (const e of etiquetas) {
      if (Math.abs(e.py - anteriorY) < 14) continue;
      anteriorY = e.py;
      svg('text', { x: x[e.i] + 10, y: e.py, class: 'grafico-valor', 'dominant-baseline': 'central' }, grafico).textContent = e.texto;
    }

    // a zona que apanha o rato (maior do que qualquer ponto)
    const alvo = svg('rect', { x: caixa.x0, y: caixa.y0, width: caixa.x1 - caixa.x0, height: caixa.y1 - caixa.y0 + 30, fill: 'transparent', class: 'grafico-alvo' }, grafico);
    const noRato = (ev) => {
      const caixaSvg = grafico.getBoundingClientRect();
      mostrarDica(maisProximo(ev.clientX - caixaSvg.left, x));
    };
    alvo.addEventListener('pointermove', noRato);
    alvo.addEventListener('pointerdown', noRato);
    alvo.addEventListener('pointerleave', (ev) => { if (ev.pointerType !== 'touch') esconderDica(); });
    grafico.addEventListener('keydown', (ev) => {
      if (!n) return;
      if (ev.key === 'ArrowRight') { ev.preventDefault(); mostrarDica(Math.min(n - 1, ativo + 1)); }
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); mostrarDica(ativo < 0 ? n - 1 : Math.max(0, ativo - 1)); }
      else if (ev.key === 'Home') { ev.preventDefault(); mostrarDica(0); }
      else if (ev.key === 'End') { ev.preventDefault(); mostrarDica(n - 1); }
      else if (ev.key === 'Escape') esconderDica();
    });
    grafico.addEventListener('focus', () => { if (ativo < 0 && n) mostrarDica(n - 1); });
    grafico.addEventListener('blur', esconderDica);

    // todos os pontos de um jogo (um por série) crescem juntos quando o jogo está em foco
    geometria = {
      x, cruz,
      pontos: Array.from({ length: n }, (_, i) => ({ setAttribute: (nome, valor) => (pontos[i] ?? []).forEach((p) => p.setAttribute(nome, valor)) })),
    };

    area.replaceChildren(grafico, dica);
    if (ativo >= 0) mostrarDica(Math.min(ativo, n - 1));
  }

  if (typeof ResizeObserver === 'function') new ResizeObserver(() => desenhar()).observe(area);
  else requestAnimationFrame(() => desenhar());

  raiz.redesenhar = () => desenhar(true);
  return raiz;
}
