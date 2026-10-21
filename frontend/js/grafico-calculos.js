// Contas dos gráficos de linhas (grafico.js): o eixo vertical, as posições, o ponto mais próximo do rato e os trocos da linha.
// Sem DOM, para se poder testar (tests/unidade/grafico-calculos.test.mjs).

/** O passo "bonito" (1, 2, 5 × 10^n) mais pequeno que serve para chegar a `max` com no máximo `alvo` passos. */
function passoBonito(max, alvo) {
  const bruto = max / alvo;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  for (const m of [1, 2, 5, 10]) {
    if (m * potencia >= bruto) return m * potencia;
  }
  return 10 * potencia;
}

/**
 * O eixo vertical de um gráfico que começa sempre em 0: o máximo e as marcas.
 * @param {number} maximoDados o maior valor a desenhar
 * @param {{fixo?: number|null, inteiros?: boolean, alvo?: number}} opcoes `fixo`: máximo imposto (100 nas percentagens);
 *   `inteiros`: só marcas inteiras (contagens); `alvo`: quantos intervalos se quer, mais coisa menos coisa.
 */
export function eixoY(maximoDados, { fixo = null, inteiros = true, alvo = 4 } = {}) {
  if (fixo != null) {
    const passo = fixo / alvo;
    return { max: fixo, ticks: Array.from({ length: alvo + 1 }, (_, i) => i * passo) };
  }
  const maximo = Math.max(Number(maximoDados) || 0, inteiros ? 1 : 0.1);
  let passo = passoBonito(maximo, alvo);
  if (inteiros) passo = Math.max(1, Math.ceil(passo));
  const max = Math.ceil(maximo / passo - 1e-9) * passo;
  const ticks = [];
  for (let t = 0; t <= max + passo / 1e6; t += passo) ticks.push(Math.round(t * 1e6) / 1e6);
  return { max, ticks };
}

/** O centro de cada uma das `n` faixas entre `x0` e `x1` (com uma só faixa, o meio). */
export function posicoesX(n, x0, x1) {
  const faixa = (x1 - x0) / Math.max(n, 1);
  return Array.from({ length: n }, (_, i) => x0 + faixa * (i + 0.5));
}

/** O índice da posição mais próxima de `x` (-1 se não há posições). */
export function maisProximo(x, posicoes) {
  let melhor = -1;
  let distancia = Infinity;
  posicoes.forEach((p, i) => {
    const d = Math.abs(p - x);
    if (d < distancia) { distancia = d; melhor = i; }
  });
  return melhor;
}

/** Quais dos `n` rótulos do eixo horizontal se escrevem para não se sobreporem (o último escreve-se sempre). */
export function rotulosVisiveis(n, larguraFaixa, larguraRotulo) {
  const passo = Math.max(1, Math.ceil(larguraRotulo / Math.max(larguraFaixa, 1)));
  const visiveis = new Set();
  for (let i = n - 1; i >= 0; i -= passo) visiveis.add(i);   // do fim para trás: o último jogo nunca fica sem rótulo
  return visiveis;
}

/** Os trocos contínuos de uma série (um valor em falta interrompe a linha): listas de {i, valor}. */
export function trocos(valores) {
  const lista = [];
  let atual = [];
  valores.forEach((valor, i) => {
    if (valor == null || Number.isNaN(Number(valor))) {
      if (atual.length) lista.push(atual);
      atual = [];
    } else atual.push({ i, valor: Number(valor) });
  });
  if (atual.length) lista.push(atual);
  return lista;
}

/** O texto de um valor: `inteiro`, `percentagem` ou `decimal`; sem valor, um traço. */
export function formatarValor(formato, valor) {
  if (valor == null || Number.isNaN(Number(valor))) return '–';
  const v = Number(valor);
  if (formato === 'percentagem') return `${Math.round(v)}%`;
  if (formato === 'decimal') return (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
  return String(Math.round(v * 10) / 10).replace('.', ',');
}
