// Relatório do intervalo: as contas de uma parte do jogo (a 1.ª) e os pontos a corrigir e a manter na seguinte.
// Tudo calculado no browser a partir do estado das estatísticas (o mesmo do dashboard), sem DOM, para se poder
// testar (tests/unidade/relatorio-intervalo.test.mjs). A página é frontend/intervalo.html.
import { ROTULO_ZONA_BALIZA, ROTULO_SISTEMA } from './api.js';
import { eficaciaDe, eficaciaPorSistema } from './analise.js';

/** Quantos pontos a corrigir e a manter aparecem no relatório. */
export const PONTOS_A_CORRIGIR = 3;
export const PONTOS_A_MANTER = 2;
/** Remates (das duas equipas) que a parte precisa de ter para os pontos não enganarem. */
export const MINIMO_REMATES = 8;

// Limiares das regras. Ficam aqui, juntos, para se acertarem num sítio só.
const LIMIARES = {
  finalizacao: { minimo: 10, fraca: 40, boa: 60 },       // eficácia da equipa (%)
  jogador: { minimo: 4, fraco: 25, bom: 60, golosBom: 3 },
  perdas: { muitas: 6, diferenca: 3, minimoComDiferenca: 4 },
  zona: { minimoFraca: 5, fraca: 25, minimoBoa: 4, boa: 65, alternativa: 50, minimoAlternativa: 3 },
  corredorSofrido: { golos: 4, parte: 0.4 },
  perigoso: { golos: 3, golosSempre: 4, parte: 0.4 },
  contraAtaque: { golos: 3 },
  guardaRedes: { minimo: 6, fraco: 25, bom: 40, defesasBom: 5, quente: 50 },
  sistema: { minimo: 5, fraco: 30, bom: 65 },
  exclusoes: { minimo: 2 },
  defesa: { minimo: 10, cede: 65, aguenta: 35 },
};

// ---------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------
const plural = (n, singular, pl) => `${n} ${n === 1 ? singular : pl}`;
const pct = (golos, remates) => `${Math.round(eficaciaDe(golos, remates))}%`;

/** Onde a equipa ataca (corredor), no feminino/masculino certo para cada frase. */
const CORREDOR = {
  PONTA_ESQ: { com: 'a ponta esquerda', de: 'da ponta esquerda', por: 'pela ponta esquerda' },
  LATERAL_ESQ: { com: 'o lateral esquerdo', de: 'do lateral esquerdo', por: 'pelo lateral esquerdo' },
  CENTRAL: { com: 'o central', de: 'do central', por: 'pelo central' },
  LATERAL_DIR: { com: 'o lateral direito', de: 'do lateral direito', por: 'pelo lateral direito' },
  PONTA_DIR: { com: 'a ponta direita', de: 'da ponta direita', por: 'pela ponta direita' },
};

/** A distância do remate: o título do ponto quando falha e a forma de a dizer numa frase. */
const DISTANCIA = {
  ATE_6M: { falha: 'Remates de perto a falhar', frase: 'até 6 m', insistir: 'Insistir nos remates de perto' },
  DE_6_A_9M: { falha: 'Remates entre 6 e 9 m a falhar', frase: 'entre 6 e 9 m', insistir: 'Insistir nos remates entre 6 e 9 m' },
  LINHA_9M: { falha: 'Remates da linha de 9 m a falhar', frase: 'da linha de 9 m', insistir: 'Insistir nos remates da linha de 9 m' },
  MAIS_9M: { falha: 'Remates de longe a falhar', frase: 'de mais de 11 m', insistir: 'Insistir nos remates de longe' },
};

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

/** O que correu mal nos remates que não foram golo: «3 fora, 2 defendidos, 1 poste». */
function falhas(lista) {
  const partes = [
    [contar(lista, 'FORA'), 'fora', 'fora'],
    [contar(lista, 'DEFESA'), 'defendido', 'defendidos'],
    [contar(lista, 'POSTE'), 'poste', 'postes'],
    [contar(lista, 'BLOQUEADO'), 'bloqueado', 'bloqueados'],
  ].filter(([n]) => n > 0);
  return partes.map(([n, singular, pl]) => (singular === pl ? `${n} ${singular}` : plural(n, singular, pl))).join(', ');
}

/**
 * Os números e os pontos de uma parte do jogo, do ponto de vista da equipa `equipaId` («nós») contra a outra («eles»).
 * `estado` é o estado das estatísticas (equipas, remates com a parte, outrosEventosPorParte, jogadores, guardaRedes, sancoes).
 * `limites` diz quantos pontos de cada tipo ficam (por omissão 3 a corrigir e 2 a manter).
 */
export function relatorioIntervalo(estado, equipaId, parte = 1, limites = {}) {
  const { corrigir: maxCorrigir = PONTOS_A_CORRIGIR, manter: maxManter = PONTOS_A_MANTER } = limites;
  const nos = estado.equipas.find((e) => e.equipaId === equipaId);
  const eles = estado.equipas.find((e) => e.equipaId !== equipaId);
  if (!nos || !eles) throw new Error('equipa desconhecida');

  const remates = (estado.remates ?? []).filter((r) => r.parte === parte);
  const nossos = remates.filter((r) => r.equipaId === nos.equipaId);
  const deles = remates.filter((r) => r.equipaId === eles.equipaId);
  const outros = (estado.outrosEventosPorParte ?? []).filter((o) => o.parte === parte);
  const eventos = (equipa, tipo) => outros.filter((o) => o.equipaId === equipa.equipaId && o.tipo === tipo).reduce((s, o) => s + o.total, 0);

  const golosNossos = golosDe(nossos);
  const golosDeles = golosDe(deles);

  // Nomes: quem rematou (jogadores) e os guarda-redes (guardaRedes); sem eles fica só o número do remate
  const jogadorPorId = new Map([...(estado.jogadores ?? []), ...(estado.guardaRedes ?? [])].map((j) => [j.jogadorId, j]));
  const rotuloJogador = (id, numeroDoRemate) => {
    const j = jogadorPorId.get(id);
    const numero = j?.numero ?? numeroDoRemate;
    return numero == null ? 'O jogador' : `#${numero}${j?.nome ? ` ${j.nome}` : ''}`;
  };

  // Guarda-redes: defesas / (defesas + golos) dos remates que a equipa adversária fez contra ele
  const guardaRedesContra = (rematesContra) => [...agrupar(rematesContra, (r) => r.guardaRedesId ?? 0).entries()]
    .map(([id, lista]) => {
      const defesas = contar(lista, 'DEFESA');
      const baliza = defesas + golosDe(lista);
      return { id: id || null, lista, defesas, baliza, percentagem: baliza ? (100 * defesas) / baliza : null };
    });
  const grNossos = guardaRedesContra(deles);       // o nosso guarda-redes sofre os remates deles
  const grDeles = guardaRedesContra(nossos);
  const somaGr = (grs) => {
    const defesas = grs.reduce((s, g) => s + g.defesas, 0);
    const baliza = grs.reduce((s, g) => s + g.baliza, 0);
    return { defesas, baliza, percentagem: baliza ? (100 * defesas) / baliza : null };
  };
  const totalGrNossos = somaGr(grNossos);
  const totalGrDeles = somaGr(grDeles);

  // ----- Tabela de números -----
  const perdas = { nos: eventos(nos, 'PERDA_BOLA'), eles: eventos(eles, 'PERDA_BOLA') };
  const exclusoes = { nos: eventos(nos, 'DOIS_MINUTOS'), eles: eventos(eles, 'DOIS_MINUTOS') };
  const sete = (lista) => lista.filter((r) => r.situacao === 'SETE_METROS');
  const contra = (lista) => lista.filter((r) => r.situacao === 'CONTRA_ATAQUE');

  const linha = (rotulo, a, b, { maior = true, texto = String, opcional = false } = {}) => ({
    rotulo,
    nos: a == null ? '–' : texto(a),
    eles: b == null ? '–' : texto(b),
    vantagem: a == null || b == null || a === b ? null : ((a > b) === maior ? 'nos' : 'eles'),
    opcional: opcional && !a && !b,
  });
  const defesasGr = (g) => (g.baliza ? `${g.defesas} (${Math.round(g.percentagem)}%)` : '–');
  const numeros = [
    linha('Golos', golosNossos, golosDeles),
    linha('Remates', nossos.length, deles.length),
    linha('Eficácia', nossos.length ? eficaciaDe(golosNossos, nossos.length) : null, deles.length ? eficaciaDe(golosDeles, deles.length) : null,
      { texto: (v) => `${Math.round(v)}%` }),
    linha('Perdas de bola', perdas.nos, perdas.eles, { maior: false }),
    { rotulo: 'Defesas do guarda-redes', nos: defesasGr(totalGrNossos), eles: defesasGr(totalGrDeles),
      vantagem: totalGrNossos.percentagem == null || totalGrDeles.percentagem == null || totalGrNossos.percentagem === totalGrDeles.percentagem
        ? null : (totalGrNossos.percentagem > totalGrDeles.percentagem ? 'nos' : 'eles'), opcional: false },
    linha('Golos de contra-ataque', golosDe(contra(nossos)), golosDe(contra(deles)), { opcional: true }),
    { rotulo: '7 metros (golos / lançamentos)', nos: `${golosDe(sete(nossos))}/${sete(nossos).length}`, eles: `${golosDe(sete(deles))}/${sete(deles).length}`,
      vantagem: null, opcional: !sete(nossos).length && !sete(deles).length },
    linha('Faltas ofensivas', eventos(nos, 'FALTA_OFENSIVA'), eventos(eles, 'FALTA_OFENSIVA'), { maior: false, opcional: true }),
    linha('Exclusões de 2 minutos', exclusoes.nos, exclusoes.eles, { maior: false, opcional: true }),
    linha('Time-outs', eventos(nos, 'TIMEOUT'), eventos(eles, 'TIMEOUT'), { opcional: true }),
  ].filter((l) => !l.opcional).map(({ opcional, ...resto }) => resto);

  // ----- Jogadores da equipa que rematou na parte -----
  const jogadores = [...agrupar(nossos, (r) => r.jogadorId).entries()].map(([id, lista]) => ({
    jogadorId: id,
    numero: jogadorPorId.get(id)?.numero ?? lista[0].jogadorNumero,
    nome: jogadorPorId.get(id)?.nome ?? '',
    remates: lista.length,
    golos: golosDe(lista),
    eficacia: eficaciaDe(golosDe(lista), lista.length),
  })).sort((a, b) => b.golos - a.golos || b.remates - a.remates || a.numero - b.numero);

  // ----- Pontos -----
  const candidatos = [];
  const propor = (tipo, codigo, peso, titulo, detalhe) => candidatos.push({ tipo, codigo, peso, titulo, detalhe });

  regraExclusoes();
  regraGuardaRedesNosso();
  regraGuardaRedesDeles();
  regraFinalizacao();
  regraJogadores();
  regraPerdas();
  regraZonas();
  regraCorredorSofrido();
  regraPerigoso();
  regraContraAtaque();
  regraSistema();
  regraExclusoesEquipa();
  regraDefesa();

  const ordenar = (a, b) => b.peso - a.peso || a.codigo.localeCompare(b.codigo);
  const escolher = (tipo, quantos) => candidatos.filter((c) => c.tipo === tipo).sort(ordenar).slice(0, quantos)
    .map(({ tipo: _tipo, ...ponto }) => ponto);

  return {
    parte,
    nos: { equipaId: nos.equipaId, nome: nos.nome },
    eles: { equipaId: eles.equipaId, nome: eles.nome },
    golos: { nos: golosNossos, eles: golosDeles },
    remates: remates.length,
    poucosDados: remates.length < MINIMO_REMATES,
    numeros,
    corrigir: escolher('corrigir', maxCorrigir),
    manter: escolher('manter', maxManter),
    jogadores,
  };

  // -------------------------------------------------------------------
  // Regras (cada uma propõe no máximo um ponto de cada tipo)
  // -------------------------------------------------------------------

  /** Um jogador nosso a um passo de ser desqualificado (já tem 2 exclusões de 2 minutos). */
  function regraExclusoes() {
    const emRisco = (estado.sancoes ?? []).filter((s) => s.equipaId === nos.equipaId && !s.expulso && s.doisMinutos >= LIMIARES.exclusoes.minimo)
      .sort((a, b) => b.doisMinutos - a.doisMinutos || a.numero - b.numero)[0];
    if (!emRisco) return;
    propor('corrigir', 'risco_expulsao', 90, `Cuidado com o #${emRisco.numero} ${emRisco.nome}`,
      `Já tem ${emRisco.doisMinutos} exclusões de 2 minutos: à terceira fica desqualificado.`);
  }

  /** O nosso guarda-redes em dificuldades ou em forma. */
  function regraGuardaRedesNosso() {
    const L = LIMIARES.guardaRedes;
    const maisExposto = [...grNossos].filter((g) => g.baliza >= L.minimo).sort((a, b) => b.baliza - a.baliza)[0];
    if (!maisExposto) return;
    const quem = maisExposto.id ? rotuloJogador(maisExposto.id) : 'O guarda-redes';
    const numerosGr = `${plural(maisExposto.defesas, 'defesa', 'defesas')} em ${maisExposto.baliza} remates à baliza (${Math.round(maisExposto.percentagem)}%)`;
    if (maisExposto.percentagem <= L.fraco) {
      propor('corrigir', 'gr_nosso_fraco', 80, 'Considerar trocar o guarda-redes', `${quem}: ${numerosGr}.`);
    } else if (maisExposto.percentagem >= L.bom && maisExposto.defesas >= L.defesasBom) {
      propor('manter', 'gr_nosso_bom', 70, 'Guarda-redes a segurar o jogo', `${quem}: ${numerosGr}.`);
    }
  }

  /** O guarda-redes deles: em forma (variar os remates) ou a ceder (continuar a rematar à baliza). */
  function regraGuardaRedesDeles() {
    const L = LIMIARES.guardaRedes;
    const maisTestado = [...grDeles].filter((g) => g.baliza >= L.minimo).sort((a, b) => b.baliza - a.baliza)[0];
    if (!maisTestado) return;
    const quem = maisTestado.id ? rotuloJogador(maisTestado.id) : 'O guarda-redes deles';
    const numerosGr = `${plural(maisTestado.defesas, 'defesa', 'defesas')} em ${maisTestado.baliza} remates à baliza (${Math.round(maisTestado.percentagem)}%)`;
    if (maisTestado.percentagem >= L.quente) {
      const porZona = new Map();
      for (const r of maisTestado.lista.filter((x) => x.resultado === 'DEFESA' && x.balizaZona)) porZona.set(r.balizaZona, (porZona.get(r.balizaZona) ?? 0) + 1);
      const zonas = [...porZona.entries()].sort((a, b) => b[1] - a[1]);
      const sobretudo = zonas.length && zonas[0][1] >= 2 && (zonas.length === 1 || zonas[0][1] > zonas[1][1])
        ? ` Defende sobretudo ${ROTULO_ZONA_BALIZA[zonas[0][0]]} (${zonas[0][1]} de ${maisTestado.defesas}).` : '';
      propor('corrigir', 'gr_deles_quente', 50 + (maisTestado.percentagem - L.quente) / 2,
        maisTestado.id ? `Variar os remates contra o guarda-redes ${rotuloJogador(maisTestado.id)}` : 'Variar os remates contra o guarda-redes',
        `${quem}: ${numerosGr}.${sobretudo}`);
    } else if (maisTestado.percentagem <= L.fraco) {
      propor('manter', 'gr_deles_fraco', 60, 'O guarda-redes deles está a ceder', `${quem}: ${numerosGr}. Continuar a rematar à baliza.`);
    }
  }

  /** A eficácia de remate da equipa na parte. */
  function regraFinalizacao() {
    const L = LIMIARES.finalizacao;
    if (nossos.length < L.minimo) return;
    const ef = eficaciaDe(golosNossos, nossos.length);
    const deles_ = deles.length ? `; o adversário leva ${pct(golosDeles, deles.length)}` : '';
    if (ef <= L.fraca) {
      propor('corrigir', 'finalizacao_fraca', Math.min(70, 50 + (L.fraca + 5 - ef)), 'Melhorar a finalização',
        `${plural(golosNossos, 'golo', 'golos')} em ${nossos.length} remates (${pct(golosNossos, nossos.length)})${deles_}.`);
    } else if (ef >= L.boa) {
      propor('manter', 'finalizacao_boa', 50, 'Finalização a funcionar', `${plural(golosNossos, 'golo', 'golos')} em ${nossos.length} remates (${pct(golosNossos, nossos.length)}).`);
    }
  }

  /** O jogador nosso que mais falha e o que mais marca. */
  function regraJogadores() {
    const L = LIMIARES.jogador;
    const comRemates = jogadores.filter((j) => j.remates >= L.minimo);
    const porId = (j) => nossos.filter((r) => r.jogadorId === j.jogadorId);

    const aFalhar = comRemates.filter((j) => j.eficacia <= L.fraco).sort((a, b) => (b.remates - b.golos) - (a.remates - a.golos) || a.numero - b.numero)[0];
    if (aFalhar) {
      const lista = porId(aFalhar);
      propor('corrigir', 'jogador_a_falhar', Math.min(85, 55 + 5 * (aFalhar.remates - aFalhar.golos)),
        `Rever o #${aFalhar.numero}${aFalhar.nome ? ` ${aFalhar.nome}` : ''}`,
        `${plural(aFalhar.golos, 'golo', 'golos')} em ${aFalhar.remates} remates (${falhas(lista)}).`);
    }

    const aMarcar = comRemates.filter((j) => j.golos >= L.golosBom && j.eficacia >= L.bom).sort((a, b) => b.golos - a.golos || b.eficacia - a.eficacia)[0];
    if (aMarcar) {
      propor('manter', 'jogador_a_marcar', 55 + 2 * aMarcar.golos, `Procurar o #${aMarcar.numero}${aMarcar.nome ? ` ${aMarcar.nome}` : ''}`,
        `${plural(aMarcar.golos, 'golo', 'golos')} em ${aMarcar.remates} remates (${pct(aMarcar.golos, aMarcar.remates)}).`);
    }
  }

  /** Perdas de bola: nossas a mais, ou deles a mais para aproveitar. */
  function regraPerdas() {
    const L = LIMIARES.perdas;
    const demais = (a, b) => a >= L.muitas || (a >= L.minimoComDiferenca && a - b >= L.diferenca);
    if (demais(perdas.nos, perdas.eles)) {
      propor('corrigir', 'perdas_nossas', 40 + 4 * (perdas.nos - 4) + Math.max(0, perdas.nos - perdas.eles), 'Cuidar da bola',
        `${plural(perdas.nos, 'perda', 'perdas')} de bola (adversário: ${perdas.eles}).`);
    } else if (demais(perdas.eles, perdas.nos)) {
      propor('manter', 'perdas_deles', 50, 'Aproveitar as perdas de bola do adversário',
        `O adversário perdeu a bola ${plural(perdas.eles, 'vez', 'vezes')} (nós: ${perdas.nos}). Vale a pena pressionar.`);
    }
  }

  /** De onde (corredor ou distância) os nossos remates falham ou resultam. */
  function regraZonas() {
    const L = LIMIARES.zona;
    const grupos = [
      ...[...agrupar(nossos, (r) => r.distancia).entries()].map(([k, lista]) => ({ dimensao: 'distancia', k, lista })),
      ...[...agrupar(nossos, (r) => r.corredor).entries()].map(([k, lista]) => ({ dimensao: 'corredor', k, lista })),
    ].map((g) => ({ ...g, n: g.lista.length, golos: golosDe(g.lista), ef: eficaciaDe(golosDe(g.lista), g.lista.length) }))
      .filter((g) => (g.dimensao === 'distancia' ? DISTANCIA[g.k] : CORREDOR[g.k]));

    const fraco = grupos.filter((g) => g.n >= L.minimoFraca && g.ef <= L.fraca).sort((a, b) => a.ef - b.ef || b.n - a.n)[0];
    if (fraco) {
      const alternativa = grupos.filter((g) => g.dimensao === fraco.dimensao && g !== fraco && g.n >= L.minimoAlternativa && g.ef >= L.alternativa)
        .sort((a, b) => b.ef - a.ef || b.n - a.n)[0];
      const onde = (g) => (g.dimensao === 'distancia' ? DISTANCIA[g.k].frase : CORREDOR[g.k].por);
      const titulo = fraco.dimensao === 'distancia' ? DISTANCIA[fraco.k].falha : `Ataque ${CORREDOR[fraco.k].por} a falhar`;
      propor('corrigir', 'zona_fraca', 50 + (L.fraca + 5 - fraco.ef) / 2, titulo,
        `${plural(fraco.golos, 'golo', 'golos')} em ${fraco.n} remates (${pct(fraco.golos, fraco.n)}) ${onde(fraco)}.`
        + (alternativa ? ` Melhor ${onde(alternativa)}: ${alternativa.golos} em ${alternativa.n}.` : ''));
    }

    const bom = grupos.filter((g) => g.n >= L.minimoBoa && g.ef >= L.boa).sort((a, b) => b.ef - a.ef || b.n - a.n)[0];
    if (bom) {
      propor('manter', 'zona_boa', 45 + (bom.ef - L.boa) / 3,
        bom.dimensao === 'distancia' ? DISTANCIA[bom.k].insistir : `Insistir ${CORREDOR[bom.k].por}`,
        `${plural(bom.golos, 'golo', 'golos')} em ${bom.n} remates (${pct(bom.golos, bom.n)}).`);
    }
  }

  /** De onde o adversário nos marca mais. */
  function regraCorredorSofrido() {
    const L = LIMIARES.corredorSofrido;
    const golosSofridos = golosDe(deles);
    const top = [...agrupar(deles.filter((r) => r.resultado === 'GOLO'), (r) => r.corredor).entries()].filter(([k]) => CORREDOR[k])
      .map(([k, lista]) => ({ k, golos: lista.length })).sort((a, b) => b.golos - a.golos)[0];
    if (!top || top.golos < L.golos || top.golos / golosSofridos < L.parte) return;
    propor('corrigir', 'corredor_sofrido', 55 + 3 * top.golos, `Fechar ${CORREDOR[top.k].com}`,
      `O adversário marcou ${top.golos} dos ${golosSofridos} golos a partir ${CORREDOR[top.k].de}.`);
  }

  /** O jogador deles que mais nos faz mal. */
  function regraPerigoso() {
    const L = LIMIARES.perigoso;
    const golosSofridos = golosDe(deles);
    const top = [...agrupar(deles, (r) => r.jogadorId).entries()]
      .map(([id, lista]) => ({ id, lista, golos: golosDe(lista), numero: lista[0].jogadorNumero }))
      .sort((a, b) => b.golos - a.golos || a.numero - b.numero)[0];
    if (!top || top.golos < L.golos || (top.golos < L.golosSempre && top.golos / golosSofridos < L.parte)) return;
    propor('corrigir', 'jogador_perigoso', Math.min(88, 60 + 5 * top.golos), `Marcar o ${rotuloJogador(top.id, top.numero)}`,
      `${top.golos} dos ${golosSofridos} golos do adversário, em ${plural(top.lista.length, 'remate', 'remates')}.`);
  }

  /** Contra-ataques: os que sofremos e os que fazemos. */
  function regraContraAtaque() {
    const L = LIMIARES.contraAtaque;
    const sofridos = contra(deles);
    if (golosDe(sofridos) >= L.golos) {
      propor('corrigir', 'contra_ataque_sofrido', Math.min(75, 45 + 5 * golosDe(sofridos)), 'Recuperar mais depressa',
        `O adversário marcou ${plural(golosDe(sofridos), 'golo', 'golos')} em contra-ataque.`);
    }
    const nossosCa = contra(nossos);
    if (golosDe(nossosCa) >= L.golos) {
      propor('manter', 'contra_ataque_nosso', 40 + 3 * golosDe(nossosCa), 'Contra-ataque a render',
        `${plural(golosDe(nossosCa), 'golo', 'golos')} em ${nossosCa.length} contra-ataques.`);
    }
  }

  /** A defesa que o adversário joga (6:0, 5:1...), quando o adjunto a marcou. */
  function regraSistema() {
    const L = LIMIARES.sistema;
    const { linhas } = eficaciaPorSistema(nossos, nos.equipaId, L.minimo);
    const comDefesa = linhas.filter((l) => l.sistema !== null && l.remates >= L.minimo);
    const fraca = comDefesa.filter((l) => l.eficacia <= L.fraco).sort((a, b) => a.eficacia - b.eficacia || b.remates - a.remates)[0];
    if (fraca) {
      const melhor = comDefesa.filter((l) => l !== fraca && l.eficacia >= 50).sort((a, b) => b.eficacia - a.eficacia)[0];
      propor('corrigir', 'sistema_dificil', 55, `Atacar melhor a defesa ${ROTULO_SISTEMA[fraca.sistema]}`,
        `${plural(fraca.golos, 'golo', 'golos')} em ${fraca.remates} remates (${pct(fraca.golos, fraca.remates)}) contra a defesa ${ROTULO_SISTEMA[fraca.sistema]}.`
        + (melhor ? ` Contra a ${ROTULO_SISTEMA[melhor.sistema]}: ${melhor.golos} em ${melhor.remates}.` : ''));
    }
    const boa = comDefesa.filter((l) => l.eficacia >= L.bom).sort((a, b) => b.eficacia - a.eficacia)[0];
    if (boa) {
      propor('manter', 'sistema_facil', 40, `Bom contra a defesa ${ROTULO_SISTEMA[boa.sistema]}`,
        `${plural(boa.golos, 'golo', 'golos')} em ${boa.remates} remates (${pct(boa.golos, boa.remates)}).`);
    }
  }

  /** Exclusões da equipa (disciplina). */
  function regraExclusoesEquipa() {
    if (exclusoes.nos >= LIMIARES.exclusoes.minimo && exclusoes.nos > exclusoes.eles) {
      propor('corrigir', 'exclusoes_nossas', 40 + 10 * (exclusoes.nos - LIMIARES.exclusoes.minimo), 'Menos exclusões',
        `${plural(exclusoes.nos, 'exclusão', 'exclusões')} de 2 minutos (adversário: ${exclusoes.eles}).`);
    }
  }

  /** O que o adversário faz com os remates que lhe deixamos fazer. */
  function regraDefesa() {
    const L = LIMIARES.defesa;
    if (deles.length < L.minimo) return;
    const ef = eficaciaDe(golosDeles, deles.length);
    if (ef >= L.cede) {
      propor('corrigir', 'defesa_a_ceder', 55 + (ef - L.cede) / 2, 'Defesa a ceder',
        `O adversário marca ${golosDeles} em ${deles.length} remates (${pct(golosDeles, deles.length)}).`);
    } else if (ef <= L.aguenta) {
      propor('manter', 'defesa_a_funcionar', 50, 'Defesa a funcionar',
        `O adversário só marcou ${golosDeles} em ${deles.length} remates (${pct(golosDeles, deles.length)}).`);
    }
  }
}

// ---------------------------------------------------------------------
// Frases do relatório que a página e o texto para copiar partilham
// ---------------------------------------------------------------------
/** O aviso de que há poucos remates para os pontos serem de confiança (ou null, se há remates que cheguem). */
export function avisoPoucosDados(relatorio) {
  if (!relatorio.poucosDados) return null;
  const n = relatorio.remates;
  return n === 0
    ? 'Ainda sem remates registados nesta parte.'
    : `Só ${plural(n, 'remate registado', 'remates registados')} nesta parte: os pontos podem enganar.`;
}

/** O que se diz quando não há nada a corrigir. */
export const semPontosACorrigir = (relatorio) => (relatorio.poucosDados
  ? 'Ainda não há remates que cheguem para apontar pontos.'
  : 'Nada de grave nos números. Continuar assim.');

// ---------------------------------------------------------------------
// Texto para copiar (WhatsApp, email...)
// ---------------------------------------------------------------------
export function textoRelatorio(relatorio) {
  const { nos, eles, golos, parte } = relatorio;
  const proxima = parte === 1 ? 'na 2.ª parte' : 'daqui para a frente';
  const linhas = [
    `${parte === 1 ? 'Intervalo' : `${parte}.ª parte`} · ${nos.nome} ${golos.nos}–${golos.eles} ${eles.nome}`,
    `Relatório da ${parte}.ª parte, para ${nos.nome}`,
    '',
  ];
  const aviso = avisoPoucosDados(relatorio);
  if (aviso) linhas.push(`(${aviso})`, '');
  linhas.push(`A corrigir ${proxima}:`);
  if (relatorio.corrigir.length) relatorio.corrigir.forEach((p, i) => linhas.push(`${i + 1}. ${p.titulo}: ${p.detalhe}`));
  else linhas.push(semPontosACorrigir(relatorio));
  if (relatorio.manter.length) {
    linhas.push('', 'A manter:');
    relatorio.manter.forEach((p) => linhas.push(`- ${p.titulo}: ${p.detalhe}`));
  }
  linhas.push('', `Números (${nos.nome} – ${eles.nome}):`);
  relatorio.numeros.forEach((n) => linhas.push(`${n.rotulo}: ${n.nos} – ${n.eles}`));
  return linhas.join('\n');
}
