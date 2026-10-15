// Estatísticas do dashboard que se calculam no browser a partir da lista de remates do jogo (a mesma do mapa):
// a eficácia contra cada defesa do adversário e o livro dos 7 metros. São contas simples; ficam aqui, sem DOM,
// para se poderem testar (tests/unidade/analise.test.mjs).
import { SISTEMAS_DEFENSIVOS, ORDEM_ZONA_BALIZA } from './api.js';

/** Remates em ataque posicional que cada defesa precisa de ter para entrar na comparação «melhor / pior» (poucos enganam). */
export const MINIMO_REMATES_SISTEMA = 4;
/** Golos e defesas com local marcado que um lançador precisa de ter para se falar numa zona preferida. */
export const MINIMO_COM_LOCAL = 3;

/** Golos / remates em percentagem com 1 casa decimal (como o servidor), ou null sem remates. */
const eficaciaDe = (golos, remates) => (remates ? Math.round((1000 * golos) / remates) / 10 : null);
const contar = (lista, resultado) => lista.filter((r) => r.resultado === resultado).length;

/**
 * A eficácia da equipa em ataque posicional contra cada defesa do adversário.
 * Devolve `linhas` (uma por defesa com remates, pela ordem de SISTEMAS_DEFENSIVOS, e no fim `sistema: null` = sem defesa
 * marcada), `marcados` (se algum remate tem defesa marcada) e, só com pelo menos duas defesas com `minimo` remates cada
 * e eficácias diferentes, `melhor` e `pior`.
 */
export function eficaciaPorSistema(remates, equipaId, minimo = MINIMO_REMATES_SISTEMA) {
  const posicionais = remates.filter((r) => r.equipaId === equipaId && r.situacao === 'POSICIONAL');
  const linhas = [...SISTEMAS_DEFENSIVOS.map((s) => s.codigo), null].map((sistema) => {
    const doSistema = posicionais.filter((r) => (r.sistemaDefensivo ?? null) === sistema);
    const golos = contar(doSistema, 'GOLO');
    return { sistema, remates: doSistema.length, golos, eficacia: eficaciaDe(golos, doSistema.length) };
  }).filter((l) => l.remates > 0);

  const comparaveis = linhas.filter((l) => l.sistema !== null && l.remates >= minimo);
  let melhor = null;
  let pior = null;
  if (comparaveis.length >= 2) {
    const porEficacia = [...comparaveis].sort((a, b) => b.eficacia - a.eficacia || b.remates - a.remates);
    const primeiro = porEficacia[0];
    const ultimo = porEficacia[porEficacia.length - 1];
    if (primeiro.eficacia !== ultimo.eficacia) { melhor = primeiro; pior = ultimo; }
  }
  return { linhas, marcados: linhas.some((l) => l.sistema !== null), melhor, pior };
}

/**
 * O livro dos 7 metros da equipa: por lançador, quantos lançou, como acabaram e para onde bateu.
 * O local na baliza só existe nos golos e nas defesas (`porZona` conta esses); `tendencia` é a zona preferida, só com
 * pelo menos `minimoComLocal` lançamentos com local e uma zona que ganhe claramente às outras.
 * Os lançadores vêm do que mais lançou para o que menos lançou.
 */
export function livroSeteMetros(remates, equipaId, minimoComLocal = MINIMO_COM_LOCAL) {
  const sete = remates.filter((r) => r.equipaId === equipaId && r.situacao === 'SETE_METROS');

  const porJogador = new Map();
  for (const r of sete) {
    if (!porJogador.has(r.jogadorId)) porJogador.set(r.jogadorId, []);
    porJogador.get(r.jogadorId).push(r);
  }

  const lancadores = [...porJogador.entries()].map(([jogadorId, lista]) => {
    const comLocal = lista.filter((r) => r.balizaX != null && r.balizaY != null);
    const porZona = {};
    for (const r of comLocal) porZona[r.balizaZona] = (porZona[r.balizaZona] ?? 0) + 1;

    const zonas = ORDEM_ZONA_BALIZA.filter((z) => porZona[z]).sort((a, b) => porZona[b] - porZona[a]);
    const preferida = comLocal.length >= minimoComLocal && zonas.length > 0 && (zonas.length === 1 || porZona[zonas[0]] > porZona[zonas[1]])
      ? { zona: zonas[0], total: porZona[zonas[0]], de: comLocal.length }
      : null;

    return {
      jogadorId,
      numero: lista[0].jogadorNumero,
      lancamentos: lista.length,
      golos: contar(lista, 'GOLO'),
      defendidos: contar(lista, 'DEFESA'),
      outros: lista.length - contar(lista, 'GOLO') - contar(lista, 'DEFESA'),   // fora, poste ou bloqueado
      eficacia: eficaciaDe(contar(lista, 'GOLO'), lista.length),
      comLocal: comLocal.length,
      semLocal: lista.filter((r) => (r.resultado === 'GOLO' || r.resultado === 'DEFESA') && r.balizaX == null).length,
      porZona,
      tendencia: preferida,
    };
  }).sort((a, b) => b.lancamentos - a.lancamentos || a.numero - b.numero);

  const golos = contar(sete, 'GOLO');
  return {
    lancadores,
    total: { lancamentos: sete.length, golos, defendidos: contar(sete, 'DEFESA'), eficacia: eficaciaDe(golos, sete.length) },
  };
}
