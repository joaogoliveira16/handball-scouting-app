// Relatório do próximo adversário (pré-jogo): o que sabemos de uma equipa pelos jogos que a conta registou dela
// (contra nós e contra outras equipas). Os pontos a explorar, os pontos a travar, os números por jogo, os jogadores
// perigosos, o livro dos 7 metros e o que cada defesa rende. Sem DOM, para se poder testar
// (tests/unidade/relatorio-adversario.test.mjs). A página é frontend/adversario.html.
//
// Recebe o que a API devolve em GET /api/equipas/{id}/adversario:
//   { equipaId, nome, jogos, jogadores, remates, outrosEventos }
// `remates` são os remates dos jogos da equipa, dela e dos adversários (equipaId diz quem rematou); `outrosEventos`
// conta, por jogo e equipa, os eventos que não são remates (perdas de bola, exclusões...).
import { ROTULO_ZONA_BALIZA, ROTULO_SISTEMA, SISTEMAS_DEFENSIVOS } from './api.js';
import { eficaciaDe, livroSeteMetros } from './analise.js';
import { CORREDOR } from './relatorio-intervalo.js';

/** Quantos pontos de cada tipo aparecem no relatório. */
export const PONTOS_A_EXPLORAR = 3;
export const PONTOS_A_TRAVAR = 3;
/** Remates da equipa que o relatório precisa para os pontos não enganarem. */
export const MINIMO_REMATES = 20;

// Limiares das regras, todos juntos para se acertarem num sítio só.
const LIMIARES = {
  finalizacao: { minimo: 30, fraca: 45, boa: 58 },                  // eficácia de remate da equipa (%)
  defesa: { minimo: 30, solida: 42 },                                // eficácia dos adversários contra a equipa (%)
  guardaRedes: { minimo: 8, fraco: 28, forte: 40, minimoForte: 10 }, // % de defesa e remates à baliza
  sistemaQueCede: { minimo: 8, cede: 65 },                           // a defesa que a equipa joga: remates sofridos e eficácia
  sistemaQueFalha: { minimo: 6, fraco: 35, alternativa: 50 },        // o ataque da equipa contra cada defesa
  corredorSofrido: { golos: 4, parte: 0.35 },
  corredorForte: { golos: 6, parte: 0.3 },
  jogador: { golos: 6, parte: 0.2 },
  contraAtaque: { porJogo: 2.5 },
  perdas: { porJogo: 10 },
  exclusoes: { porJogo: 3 },
  zonaPreferida: { minimoComLocal: 10, parte: 0.25 },
  seteMetros: { minimo: 3, bom: 0.75, fraco: 0.4 },
};

// ---------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------
const plural = (n, singular, pl) => `${n} ${n === 1 ? singular : pl}`;
const pct = (golos, remates) => `${Math.round(eficaciaDe(golos, remates))}%`;
const virgula = (numero) => (Math.round(numero * 10) / 10).toFixed(1).replace('.', ',');
const rotuloJogador = (j) => (j.numero == null ? 'guarda-redes' : `#${j.numero}${j.nome ? ` ${j.nome}` : ''}`);

// ---------------------------------------------------------------------
// Contas
// ---------------------------------------------------------------------
const golosDe = (lista) => lista.filter((r) => r.resultado === 'GOLO').length;
const contar = (lista, resultado) => lista.filter((r) => r.resultado === resultado).length;

function agrupar(lista, chave) {
  const grupos = new Map();
  for (const item of lista) {
    const k = chave(item);
    if (k == null) continue;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(item);
  }
  return grupos;
}

/** O resultado de um jogo visto da equipa: 'V', 'E' ou 'D'. */
export const resultadoDe = (jogo) => (jogo.golos > jogo.golosAdversario ? 'V' : jogo.golos < jogo.golosAdversario ? 'D' : 'E');

/** Os remates em ataque posicional agrupados pela defesa do adversário (só os que têm defesa marcada), pela ordem do código. */
export function linhasPorSistema(remates) {
  const posicionais = remates.filter((r) => r.situacao === 'POSICIONAL' && r.sistemaDefensivo);
  return SISTEMAS_DEFENSIVOS.map((s) => {
    const lista = posicionais.filter((r) => r.sistemaDefensivo === s.codigo);
    const golos = golosDe(lista);
    return { sistema: s.codigo, remates: lista.length, golos, eficacia: eficaciaDe(golos, lista.length) };
  }).filter((l) => l.remates > 0);
}

/** Guarda-redes: defesas / (defesas + golos) dos remates que sofreu. `id` é null nos remates sem guarda-redes marcado. */
function guardaRedesContra(rematesContra) {
  return [...agrupar(rematesContra, (r) => r.guardaRedesId ?? 0).entries()].map(([id, lista]) => {
    const defesas = contar(lista, 'DEFESA');
    const golos = golosDe(lista);
    const baliza = defesas + golos;
    return { id: id || null, lista, defesas, golos, baliza, percentagem: baliza ? (100 * defesas) / baliza : null };
  });
}

/** A zona da baliza que mais se repete entre os remates (golos e defesas com local) se ganhar claramente às outras. */
function zonaPrincipal(lista, minimo = 2) {
  const porZona = new Map();
  for (const r of lista.filter((x) => (x.resultado === 'GOLO' || x.resultado === 'DEFESA') && x.balizaZona)) {
    porZona.set(r.balizaZona, (porZona.get(r.balizaZona) ?? 0) + 1);
  }
  const zonas = [...porZona.entries()].sort((a, b) => b[1] - a[1]);
  const total = zonas.reduce((s, [, n]) => s + n, 0);
  if (!zonas.length || zonas[0][1] < minimo || (zonas.length > 1 && zonas[0][1] === zonas[1][1])) return null;
  return { zona: zonas[0][0], total: zonas[0][1], de: total };
}

/**
 * O relatório de uma equipa a partir dos jogos registados dela.
 * `contraEquipaId`: só os jogos contra essa equipa (por exemplo, a da conta); sem ele contam todos.
 * `limites`: quantos pontos de cada tipo ficam (por omissão 3 a explorar e 3 a travar).
 */
export function relatorioAdversario(dados, { contraEquipaId = null, limites = {} } = {}) {
  const { explorar: maxExplorar = PONTOS_A_EXPLORAR, travar: maxTravar = PONTOS_A_TRAVAR } = limites;
  const equipaId = dados.equipaId;

  const todosOsJogos = [...(dados.jogos ?? [])].sort((a, b) => Date.parse(a.dataHora) - Date.parse(b.dataHora) || a.jogoId - b.jogoId);
  const jogos = todosOsJogos.filter((j) => contraEquipaId == null || j.adversarioId === contraEquipaId)
    .map((j) => ({ ...j, golos: Number(j.golos), golosAdversario: Number(j.golosAdversario), resultado: resultadoDe(j) }));
  const ids = new Set(jogos.map((j) => j.jogoId));
  const n = jogos.length;

  const remates = (dados.remates ?? []).filter((r) => ids.has(r.jogoId));
  const dela = remates.filter((r) => r.equipaId === equipaId);          // os remates da equipa
  const contra = remates.filter((r) => r.equipaId !== equipaId);        // os remates que sofreu
  const outros = (dados.outrosEventos ?? []).filter((o) => ids.has(o.jogoId) && o.equipaId === equipaId);
  const eventos = (tipo) => outros.filter((o) => o.tipo === tipo).reduce((s, o) => s + Number(o.total), 0);

  const jogadorPorId = new Map((dados.jogadores ?? []).map((j) => [j.jogadorId ?? j.id, j]));
  const jogadorDe = (id, numeroDoRemate) => {
    const j = jogadorPorId.get(id);
    return { numero: j?.numero ?? numeroDoRemate, nome: j?.nome ?? '', posicao: j?.posicao ?? null };
  };

  const golosMarcados = jogos.reduce((s, j) => s + j.golos, 0);
  const golosSofridos = jogos.reduce((s, j) => s + j.golosAdversario, 0);
  const golosDela = golosDe(dela);
  const golosContra = golosDe(contra);
  const porJogo = (total) => (n ? total / n : null);

  // ----- Guarda-redes da equipa (os que sofreram os remates dos adversários) -----
  const grs = guardaRedesContra(contra);
  const totalGr = (() => {
    const defesas = grs.reduce((s, g) => s + g.defesas, 0);
    const baliza = grs.reduce((s, g) => s + g.baliza, 0);
    return { defesas, baliza, percentagem: baliza ? (100 * defesas) / baliza : null };
  })();

  // ----- Jogadores (quem rematou), do que mais marca para o que menos marca -----
  const jogadores = [...agrupar(dela, (r) => r.jogadorId).entries()].map(([id, lista]) => {
    const { numero, nome, posicao } = jogadorDe(id, lista[0].jogadorNumero);
    const golos = golosDe(lista);
    return {
      jogadorId: id, numero, nome, posicao,
      jogos: new Set(lista.map((r) => r.jogoId)).size,
      remates: lista.length, golos, eficacia: eficaciaDe(golos, lista.length),
      seteMetros: lista.filter((r) => r.situacao === 'SETE_METROS').length,
    };
  }).sort((a, b) => b.golos - a.golos || b.remates - a.remates || a.numero - b.numero);

  // ----- 7 metros: o que lança e o que defende -----
  const lancadores = livroSeteMetros(dela, equipaId, LIMIARES.seteMetros.minimo).lancadores.map((l) => ({ ...l, ...jogadorDe(l.jogadorId, l.numero) }));
  const seteContra = contra.filter((r) => r.situacao === 'SETE_METROS');
  const livroSete = {
    lancadores,
    total: { lancamentos: dela.filter((r) => r.situacao === 'SETE_METROS').length, golos: golosDe(dela.filter((r) => r.situacao === 'SETE_METROS')) },
    sofridos: { lancamentos: seteContra.length, golos: golosDe(seteContra), defendidos: contar(seteContra, 'DEFESA') },
  };

  // ----- Defesas: o ataque dela contra cada uma e a que ela joga (e o que rende) -----
  const ataqueContraDefesas = linhasPorSistema(dela);
  const defesasQueJoga = linhasPorSistema(contra).map((l) => ({ ...l, parte: l.remates }));
  const totalDefesasMarcadas = defesasQueJoga.reduce((s, l) => s + l.remates, 0);
  defesasQueJoga.forEach((l) => { l.parte = totalDefesasMarcadas ? l.remates / totalDefesasMarcadas : 0; });

  // ----- Golos por corredor (de onde ela marca e de onde lhe marcam) -----
  const golosPorCorredor = (lista) => [...agrupar(lista.filter((r) => r.resultado === 'GOLO'), (r) => r.corredor).entries()]
    .filter(([k]) => CORREDOR[k]).map(([k, l]) => ({ corredor: k, golos: l.length })).sort((a, b) => b.golos - a.golos);
  const corredoresDela = golosPorCorredor(dela);
  const corredoresSofridos = golosPorCorredor(contra);

  // ----- Para onde remata na baliza (para o nosso guarda-redes) -----
  const zonaDela = zonaPrincipal(dela, 1);
  const comLocal = dela.filter((r) => (r.resultado === 'GOLO' || r.resultado === 'DEFESA') && r.balizaZona).length;

  const perdas = eventos('PERDA_BOLA');
  const exclusoes = eventos('DOIS_MINUTOS');
  const golosContraAtaque = golosDe(dela.filter((r) => r.situacao === 'CONTRA_ATAQUE'));

  // ----- Números por jogo -----
  const vitorias = jogos.filter((j) => j.resultado === 'V').length;
  const empates = jogos.filter((j) => j.resultado === 'E').length;
  const derrotas = jogos.filter((j) => j.resultado === 'D').length;
  const numeros = n ? [
    { rotulo: 'Jogos (vitórias-empates-derrotas)', valor: `${n} (${vitorias}-${empates}-${derrotas})` },
    { rotulo: 'Golos marcados por jogo', valor: virgula(golosMarcados / n) },
    { rotulo: 'Golos sofridos por jogo', valor: virgula(golosSofridos / n) },
    { rotulo: 'Remates por jogo', valor: virgula(dela.length / n) },
    { rotulo: 'Eficácia de remate', valor: dela.length ? pct(golosDela, dela.length) : '–' },
    { rotulo: 'Eficácia dos adversários contra eles', valor: contra.length ? pct(golosContra, contra.length) : '–' },
    { rotulo: 'Defesas dos guarda-redes', valor: totalGr.baliza ? `${totalGr.defesas} em ${totalGr.baliza} (${Math.round(totalGr.percentagem)}%)` : '–' },
    { rotulo: 'Perdas de bola por jogo', valor: virgula(perdas / n) },
    { rotulo: 'Exclusões de 2 minutos por jogo', valor: virgula(exclusoes / n) },
    { rotulo: 'Golos de contra-ataque por jogo', valor: virgula(golosContraAtaque / n) },
    { rotulo: '7 metros (golos / lançamentos)', valor: `${livroSete.total.golos}/${livroSete.total.lancamentos}` },
  ] : [];

  // ----- Pontos -----
  const candidatos = [];
  const propor = (tipo, codigo, peso, titulo, detalhe) => candidatos.push({ tipo, codigo, peso, titulo, detalhe });

  if (n) {
    regraGuardaRedesFraco();
    regraDefesaCede();
    regraCorredorSofrido();
    regraAtaqueContraDefesa();
    regraPerdas();
    regraExclusoes();
    regraFinalizacaoFraca();
    regraSeteMetrosFraco();

    regraJogadorPerigoso();
    regraCorredorForte();
    regraContraAtaque();
    regraGuardaRedesForte();
    regraZonaPreferida();
    regraSeteMetrosBom();
    regraFinalizacaoBoa();
    regraDefesaSolida();
  }

  const ordenar = (a, b) => b.peso - a.peso || a.codigo.localeCompare(b.codigo);
  const escolher = (tipo, quantos) => candidatos.filter((c) => c.tipo === tipo).sort(ordenar).slice(0, quantos)
    .map(({ tipo: _tipo, peso: _peso, ...ponto }) => ponto);

  return {
    equipa: { equipaId, nome: dados.nome },
    contraEquipaId,
    jogos,
    nJogos: n,
    totalJogos: todosOsJogos.length,
    remates: dela.length,
    poucosDados: dela.length < MINIMO_REMATES,
    golos: { marcados: golosMarcados, sofridos: golosSofridos },
    numeros,
    explorar: escolher('explorar', maxExplorar),
    travar: escolher('travar', maxTravar),
    jogadores,
    seteMetros: livroSete,
    ataqueContraDefesas,
    defesasQueJoga,
    corredores: { dela: corredoresDela, sofridos: corredoresSofridos },
    zonaDaBaliza: zonaDela && comLocal >= LIMIARES.zonaPreferida.minimoComLocal ? { ...zonaDela, de: comLocal } : null,
    guardaRedes: grs.filter((g) => g.id).map((g) => ({ ...g, ...jogadorDe(g.id), lista: undefined }))
      .sort((a, b) => b.baliza - a.baliza || a.numero - b.numero),
  };

  // -------------------------------------------------------------------
  // Regras: a explorar (o que a equipa faz mal)
  // -------------------------------------------------------------------

  /** O guarda-redes que mais cede (um identificado, ou todos juntos se não foram marcados). */
  function regraGuardaRedesFraco() {
    const L = LIMIARES.guardaRedes;
    const identificado = grs.filter((g) => g.id && g.baliza >= L.minimo && g.percentagem <= L.fraco).sort((a, b) => a.percentagem - b.percentagem || b.baliza - a.baliza)[0];
    const alvo = identificado ?? (totalGr.baliza >= L.minimo && totalGr.percentagem <= L.fraco ? { id: null, ...totalGr, golos: totalGr.baliza - totalGr.defesas, lista: contra } : null);
    if (!alvo) return;
    const quem = alvo.id ? rotuloJogador(jogadorDe(alvo.id)) : 'Os guarda-redes';
    const zona = zonaPrincipal(alvo.lista.filter((r) => r.resultado === 'GOLO'), 3);
    propor('explorar', 'gr_fraco', 70 + (L.fraco - alvo.percentagem) / 2,
      alvo.id ? `Rematar à baliza contra o ${quem}` : 'Rematar à baliza: os guarda-redes cedem',
      `${quem}: ${plural(alvo.defesas, 'defesa', 'defesas')} em ${alvo.baliza} remates à baliza (${Math.round(alvo.percentagem)}%).`
      + (zona ? ` Cede sobretudo ${ROTULO_ZONA_BALIZA[zona.zona]} (${zona.total} de ${alvo.golos} golos).` : ''));
  }

  /** A defesa que a equipa joga e que mais cede. */
  function regraDefesaCede() {
    const L = LIMIARES.sistemaQueCede;
    const pior = defesasQueJoga.filter((l) => l.remates >= L.minimo && l.eficacia >= L.cede).sort((a, b) => b.eficacia - a.eficacia || b.remates - a.remates)[0];
    if (!pior) return;
    propor('explorar', 'defesa_cede', 60 + (pior.eficacia - L.cede) / 2, `A defesa ${ROTULO_SISTEMA[pior.sistema]} deles cede`,
      `Sofrem ${plural(pior.golos, 'golo', 'golos')} em ${pior.remates} remates (${pct(pior.golos, pior.remates)}) quando jogam ${ROTULO_SISTEMA[pior.sistema]}.`);
  }

  /** De onde lhe marcam mais. */
  function regraCorredorSofrido() {
    const L = LIMIARES.corredorSofrido;
    const top = corredoresSofridos[0];
    if (!top || top.golos < L.golos || top.golos / golosContra < L.parte) return;
    propor('explorar', 'corredor_cede', 55 + 3 * top.golos, `Atacar ${CORREDOR[top.corredor].por}`,
      `${top.golos} dos ${golosContra} golos que sofrem vêm ${CORREDOR[top.corredor].de}.`);
  }

  /** A defesa contra a qual a equipa mais falha no ataque: a que convém jogar. */
  function regraAtaqueContraDefesa() {
    const L = LIMIARES.sistemaQueFalha;
    const fraca = ataqueContraDefesas.filter((l) => l.remates >= L.minimo && l.eficacia <= L.fraco).sort((a, b) => a.eficacia - b.eficacia || b.remates - a.remates)[0];
    if (!fraca) return;
    const melhor = ataqueContraDefesas.filter((l) => l !== fraca && l.remates >= L.minimo && l.eficacia >= L.alternativa).sort((a, b) => b.eficacia - a.eficacia)[0];
    propor('explorar', 'ataque_contra_defesa', 65 + (L.fraco - fraca.eficacia) / 2, `Defender em ${ROTULO_SISTEMA[fraca.sistema]}`,
      `Contra a defesa ${ROTULO_SISTEMA[fraca.sistema]} só marcam ${fraca.golos} em ${fraca.remates} remates (${pct(fraca.golos, fraca.remates)}).`
      + (melhor ? ` Contra a ${ROTULO_SISTEMA[melhor.sistema]}: ${melhor.golos} em ${melhor.remates}.` : ''));
  }

  /** Perde muitas bolas: pressionar a saída. */
  function regraPerdas() {
    const media = porJogo(perdas);
    if (media < LIMIARES.perdas.porJogo) return;
    propor('explorar', 'perdas', 40 + 3 * (media - LIMIARES.perdas.porJogo), 'Pressionar a saída de bola',
      `${plural(perdas, 'perda', 'perdas')} de bola em ${plural(n, 'jogo', 'jogos')} (${virgula(media)} por jogo).`);
  }

  /** Muitas exclusões: provocar o contacto e jogar em superioridade. */
  function regraExclusoes() {
    const media = porJogo(exclusoes);
    if (media < LIMIARES.exclusoes.porJogo) return;
    propor('explorar', 'exclusoes', 45 + 6 * (media - LIMIARES.exclusoes.porJogo), 'Procurar a superioridade numérica',
      `${plural(exclusoes, 'exclusão', 'exclusões')} de 2 minutos em ${plural(n, 'jogo', 'jogos')} (${virgula(media)} por jogo).`);
  }

  /** Finalização fraca no conjunto dos jogos. */
  function regraFinalizacaoFraca() {
    const L = LIMIARES.finalizacao;
    if (dela.length < L.minimo) return;
    const ef = eficaciaDe(golosDela, dela.length);
    if (ef > L.fraca) return;
    propor('explorar', 'finalizacao_fraca', 50 + (L.fraca + 5 - ef), 'Finalização fraca',
      `${plural(golosDela, 'golo', 'golos')} em ${dela.length} remates (${pct(golosDela, dela.length)}).`);
  }

  /** Um lançador de 7 metros que falha. */
  function regraSeteMetrosFraco() {
    const L = LIMIARES.seteMetros;
    const fraco = lancadores.filter((l) => l.lancamentos >= L.minimo && l.golos / l.lancamentos <= L.fraco).sort((a, b) => a.golos / a.lancamentos - b.golos / b.lancamentos || b.lancamentos - a.lancamentos)[0];
    if (!fraco) return;
    propor('explorar', 'sete_metros_fraco', 48, `${rotuloJogador(fraco)} falha os 7 metros`,
      `${fraco.golos} golos em ${fraco.lancamentos} lançamentos (${fraco.defendidos} defendidos).`);
  }

  // -------------------------------------------------------------------
  // Regras: a travar (o que a equipa faz bem)
  // -------------------------------------------------------------------

  /** O jogador que mais marca. */
  function regraJogadorPerigoso() {
    const L = LIMIARES.jogador;
    const top = jogadores[0];
    if (!top || top.golos < L.golos || top.golos / golosDela < L.parte) return;
    propor('travar', 'jogador_perigoso', Math.min(90, 60 + 40 * (top.golos / golosDela)), `Marcar de perto o ${rotuloJogador(top)}`,
      `${top.golos} dos ${golosDela} golos (${pct(top.golos, golosDela)}), com ${pct(top.golos, top.remates)} de eficácia em ${plural(top.remates, 'remate', 'remates')}.`);
  }

  /** De onde a equipa marca mais. */
  function regraCorredorForte() {
    const L = LIMIARES.corredorForte;
    const top = corredoresDela[0];
    if (!top || top.golos < L.golos || top.golos / golosDela < L.parte) return;
    propor('travar', 'corredor_forte', 55 + 2 * top.golos, `Fechar ${CORREDOR[top.corredor].com}`,
      `${top.golos} dos ${golosDela} golos vêm ${CORREDOR[top.corredor].de}.`);
  }

  /** Contra-ataque: recuperar depressa. */
  function regraContraAtaque() {
    const media = porJogo(golosContraAtaque);
    if (media < LIMIARES.contraAtaque.porJogo) return;
    propor('travar', 'contra_ataque', 45 + 4 * media, 'Recuperar depressa',
      `${plural(golosContraAtaque, 'golo', 'golos')} em contra-ataque em ${plural(n, 'jogo', 'jogos')} (${virgula(media)} por jogo).`);
  }

  /** O guarda-redes em forma: variar os remates. */
  function regraGuardaRedesForte() {
    const L = LIMIARES.guardaRedes;
    const forte = grs.filter((g) => g.id && g.baliza >= L.minimoForte && g.percentagem >= L.forte).sort((a, b) => b.percentagem - a.percentagem || b.baliza - a.baliza)[0];
    if (!forte) return;
    const zona = zonaPrincipal(forte.lista.filter((r) => r.resultado === 'DEFESA'), 3);
    propor('travar', 'gr_forte', 50 + (forte.percentagem - L.forte) / 2, `Variar os remates contra o ${rotuloJogador(jogadorDe(forte.id))}`,
      `${plural(forte.defesas, 'defesa', 'defesas')} em ${forte.baliza} remates à baliza (${Math.round(forte.percentagem)}%).`
      + (zona ? ` Defende sobretudo ${ROTULO_ZONA_BALIZA[zona.zona]} (${zona.total} de ${forte.defesas}).` : ''));
  }

  /** Para onde a equipa remata na baliza (avisa o nosso guarda-redes). */
  function regraZonaPreferida() {
    const L = LIMIARES.zonaPreferida;
    if (!zonaDela || comLocal < L.minimoComLocal || zonaDela.total / comLocal < L.parte) return;
    propor('travar', 'zona_preferida', 45 + 40 * (zonaDela.total / comLocal), `Preparar o guarda-redes: ${ROTULO_ZONA_BALIZA[zonaDela.zona]}`,
      `${zonaDela.total} dos ${comLocal} remates com local (golos e defesas) foram para ${ROTULO_ZONA_BALIZA[zonaDela.zona]}.`);
  }

  /** O lançador de 7 metros seguro (e para onde bate). */
  function regraSeteMetrosBom() {
    const L = LIMIARES.seteMetros;
    const bom = lancadores.filter((l) => l.lancamentos >= L.minimo && l.golos / l.lancamentos >= L.bom).sort((a, b) => b.lancamentos - a.lancamentos || b.golos - a.golos)[0];
    if (!bom) return;
    propor('travar', 'sete_metros_bom', 42 + bom.lancamentos, `7 metros: ${rotuloJogador(bom)}`,
      `${bom.golos} golos em ${bom.lancamentos} lançamentos.`
      + (bom.tendencia ? ` Bate sobretudo ${ROTULO_ZONA_BALIZA[bom.tendencia.zona]} (${bom.tendencia.total} de ${bom.tendencia.de}).` : ''));
  }

  /** Finalização forte no conjunto dos jogos. */
  function regraFinalizacaoBoa() {
    const L = LIMIARES.finalizacao;
    if (dela.length < L.minimo) return;
    const ef = eficaciaDe(golosDela, dela.length);
    if (ef < L.boa) return;
    propor('travar', 'finalizacao_boa', 45 + (ef - L.boa), 'Finalização forte',
      `${plural(golosDela, 'golo', 'golos')} em ${dela.length} remates (${pct(golosDela, dela.length)}).`);
  }

  /** A defesa da equipa aguenta os adversários. */
  function regraDefesaSolida() {
    const L = LIMIARES.defesa;
    if (contra.length < L.minimo) return;
    const ef = eficaciaDe(golosContra, contra.length);
    if (ef > L.solida) return;
    propor('travar', 'defesa_solida', 42 + (L.solida + 5 - ef) / 2, 'Defesa sólida',
      `Os adversários só marcam ${golosContra} em ${contra.length} remates (${pct(golosContra, contra.length)}).`);
  }
}

// ---------------------------------------------------------------------
// Frases do relatório que a página e o texto para copiar partilham
// ---------------------------------------------------------------------
/** O aviso de que há poucos dados para os pontos serem de confiança (ou null, se há dados que cheguem). */
export function avisoPoucosDados(relatorio) {
  if (!relatorio.nJogos) return null;
  if (!relatorio.poucosDados) return null;
  return `Só ${plural(relatorio.remates, 'remate registado', 'remates registados')} em ${plural(relatorio.nJogos, 'jogo', 'jogos')}: os pontos podem enganar.`;
}

/** O que se diz quando uma lista de pontos está vazia. */
export const semPontos = (relatorio, tipo) => {
  if (!relatorio.nJogos) return 'Ainda não há jogos registados desta equipa.';
  if (relatorio.poucosDados) return 'Ainda não há remates que cheguem para apontar pontos.';
  return tipo === 'explorar' ? 'Nenhuma fraqueza clara nos números.' : 'Nenhum ponto forte que se destaque.';
};

/** O texto «Baseado em 3 jogos (2 contra a tua equipa)». */
export function descricaoDosJogos(relatorio, nomeNossaEquipa = null) {
  const { nJogos, contraEquipaId, jogos } = relatorio;
  if (!nJogos) return 'Sem jogos registados.';
  if (contraEquipaId != null) return `Baseado em ${plural(nJogos, 'jogo', 'jogos')} contra ${nomeNossaEquipa ?? 'a tua equipa'}.`;
  const contraNos = nomeNossaEquipa ? jogos.filter((j) => j.adversarioNome === nomeNossaEquipa).length : 0;
  return `Baseado em ${plural(nJogos, 'jogo registado', 'jogos registados')}${contraNos ? ` (${contraNos} contra ${nomeNossaEquipa})` : ''}.`;
}

// ---------------------------------------------------------------------
// Texto para copiar (WhatsApp, email...)
// ---------------------------------------------------------------------
export function textoRelatorio(relatorio, nomeNossaEquipa = null) {
  const { equipa } = relatorio;
  const linhas = [`Relatório do adversário · ${equipa.nome}`, descricaoDosJogos(relatorio, nomeNossaEquipa), ''];
  const aviso = avisoPoucosDados(relatorio);
  if (aviso) linhas.push(`(${aviso})`, '');
  linhas.push('A explorar:');
  if (relatorio.explorar.length) relatorio.explorar.forEach((p, i) => linhas.push(`${i + 1}. ${p.titulo}: ${p.detalhe}`));
  else linhas.push(semPontos(relatorio, 'explorar'));
  linhas.push('', 'A travar:');
  if (relatorio.travar.length) relatorio.travar.forEach((p, i) => linhas.push(`${i + 1}. ${p.titulo}: ${p.detalhe}`));
  else linhas.push(semPontos(relatorio, 'travar'));
  if (relatorio.numeros.length) {
    linhas.push('', 'Números:');
    relatorio.numeros.forEach((x) => linhas.push(`${x.rotulo}: ${x.valor}`));
  }
  const perigosos = relatorio.jogadores.filter((j) => j.golos > 0).slice(0, 5);
  if (perigosos.length) {
    linhas.push('', 'Quem marca:');
    perigosos.forEach((j) => linhas.push(`#${j.numero}${j.nome ? ` ${j.nome}` : ''}: ${j.golos} golos em ${j.remates} remates (${Math.round(j.eficacia)}%)`));
  }
  return linhas.join('\n');
}
