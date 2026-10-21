// Contas da página «Eventos do jogo» (corrigir um evento já registado). Sem DOM nem rede: testado à parte
// em tests/unidade/eventos-jogo.test.mjs. A página (eventos.js) só desenha.

export const SEGUNDOS_MAXIMOS = 7200;           // o mesmo limite da API
export const RESULTADOS_COM_LOCAL_NA_BALIZA = ['GOLO', 'DEFESA'];   // só nestes se marca onde a bola entrou ou foi defendida
const TIPO_VERMELHO = 'VERMELHO';

const numero = (valor) => (valor == null || valor === '' ? null : Number(valor));

/** 754 -> "12:34" (os minutos podem passar de 59: o jogo pode ter prolongamento). */
export function textoMinuto(segundos) {
  const s = Math.max(0, Math.floor(Number(segundos) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** "12:34" -> 754; "7" são 7 minutos (420); null se não for um minuto válido (ou passar do limite da API). */
export function lerMinuto(texto) {
  const t = String(texto ?? '').trim();
  let segundos;
  const completo = /^(\d{1,3}):([0-5]\d)$/.exec(t);
  if (completo) segundos = Number(completo[1]) * 60 + Number(completo[2]);
  else if (/^\d{1,3}$/.test(t)) segundos = Number(t) * 60;
  else return null;
  return segundos <= SEGUNDOS_MAXIMOS ? segundos : null;
}

/** Os valores do formulário de correção, a partir de um evento que a API devolveu. */
export function valoresDoEvento(e) {
  return {
    tipo: e.tipoEvento,
    eRemate: Boolean(e.eRemate),
    equipaId: e.equipaId,
    jogadorId: e.jogadorId ?? null,
    guardaRedesId: e.guardaRedesId ?? null,
    resultado: e.resultado ?? null,
    situacao: e.situacao ?? 'POSICIONAL',
    sistemaDefensivo: e.sistemaDefensivo ?? null,
    parte: Number(e.parte),
    minuto: textoMinuto(e.segundoJogo),
    x: numero(e.x),
    y: numero(e.y),
    balizaX: numero(e.balizaX),
    balizaY: numero(e.balizaY),
  };
}

/**
 * O corpo do PUT /api/jogos/{id}/eventos/{eventoId}. O que não faz sentido para o tipo ou para o resultado vai a null
 * (a API recusa, por exemplo, coordenadas num 2 minutos, local na baliza num remate fora ou defesa numa contra-ataque).
 */
export function corpoDoEvento(v) {
  const base = {
    tipoEvento: v.tipo,
    equipaId: v.equipaId,
    jogadorId: v.jogadorId ?? null,
    parte: v.parte,
    segundoJogo: lerMinuto(v.minuto),
  };
  if (!v.eRemate) {
    return { ...base, guardaRedesId: null, resultado: null, situacao: null, x: null, y: null, balizaX: null, balizaY: null, sistemaDefensivo: null };
  }
  const comLocal = RESULTADOS_COM_LOCAL_NA_BALIZA.includes(v.resultado) && v.balizaX != null && v.balizaY != null;
  return {
    ...base,
    guardaRedesId: v.guardaRedesId ?? null,
    resultado: v.resultado,
    situacao: v.situacao,
    x: v.x,
    y: v.y,
    balizaX: comLocal ? v.balizaX : null,
    balizaY: comLocal ? v.balizaY : null,
    sistemaDefensivo: v.situacao === 'POSICIONAL' ? (v.sistemaDefensivo ?? null) : null,
  };
}

/** O que está mal no formulário, em português para mostrar a quem corrige (lista vazia = pode guardar). */
export function erros(v) {
  const lista = [];
  if (lerMinuto(v.minuto) == null) lista.push('Escreve o minuto como minutos e segundos, por exemplo 12:34.');
  if (v.parte !== 1 && v.parte !== 2) lista.push('Escolhe a parte.');
  if ((v.eRemate || v.tipo === TIPO_VERMELHO) && v.jogadorId == null) lista.push('Escolhe o jogador.');
  if (v.eRemate) {
    if (!v.resultado) lista.push('Escolhe o resultado do remate.');
    if (v.x == null || v.y == null) lista.push('Toca no mapa para marcar de onde foi o remate.');
  }
  return lista;
}

/** Os jogadores de uma equipa, por número. */
export function jogadoresDaEquipa(jogadores, equipaId) {
  return jogadores.filter((j) => j.equipaId === equipaId).sort((a, b) => a.numero - b.numero);
}

/** Os guarda-redes da equipa que defende (a outra) quando `equipaId` ataca. */
export function guardaRedesAdversarios(jogadores, equipaId, jogo) {
  const defensora = equipaId === jogo.casaId ? jogo.foraId : jogo.casaId;
  return jogadoresDaEquipa(jogadores, defensora).filter((j) => j.posicao === 'GR');
}

/** Passar o evento para a outra equipa: o jogador e o guarda-redes deixam de servir e têm de ser escolhidos outra vez. */
export function mudarEquipa(v, equipaId) {
  if (equipaId === v.equipaId) return v;
  return { ...v, equipaId, jogadorId: null, guardaRedesId: null };
}

/** Mudar o resultado: o local na baliza só existe numa defesa ou num golo (nos outros resultados deixa de haver). */
export function mudarResultado(v, resultado) {
  const comLocal = RESULTADOS_COM_LOCAL_NA_BALIZA.includes(resultado);
  return { ...v, resultado, balizaX: comLocal ? v.balizaX : null, balizaY: comLocal ? v.balizaY : null };
}

/** Mudar a situação: a defesa do adversário só se indica num ataque posicional. */
export function mudarSituacao(v, situacao) {
  return { ...v, situacao, sistemaDefensivo: situacao === 'POSICIONAL' ? v.sistemaDefensivo : null };
}

/** Há alguma coisa diferente do que está guardado? (decide se «Guardar» está ligado) */
export function mudou(inicial, atual) {
  return JSON.stringify(corpoDoEvento(inicial)) !== JSON.stringify(corpoDoEvento(atual));
}

/**
 * Filtra a lista de eventos. `grupo`: 'todos', 'remates' ou 'outros'; `equipaId`, `parte` e `jogadorId` a null não filtram.
 */
export function filtrarEventos(eventos, { equipaId = null, grupo = 'todos', parte = null, jogadorId = null } = {}) {
  return eventos.filter((e) =>
    (equipaId == null || e.equipaId === equipaId)
    && (parte == null || Number(e.parte) === parte)
    && (jogadorId == null || e.jogadorId === jogadorId)
    && (grupo === 'todos' || (grupo === 'remates' ? e.eRemate : !e.eRemate)));
}
