// Superioridade numérica "agora": o que o banco e o dashboard mostram enquanto o jogo decorre.
// O cálculo das estatísticas (eficácia por situação, tempo em superioridade) é feito no servidor (Numerica.cs);
// aqui só se conta o que falta a cada sanção. Não depende do browser, por isso testa-se com node (tests/unidade).

/** Duração de cada sanção, em segundos de jogo (o servidor manda o valor certo em numerica.duracaoSegundos). */
export const DURACAO_SANCAO = 120;
/** Em campo ficam sempre pelo menos 4 jogadores: no máximo 2 a menos por equipa. */
export const MAXIMO_A_MENOS = 2;

export const SITUACOES_NUMERICAS = ['SUPERIORIDADE', 'IGUALDADE', 'INFERIORIDADE', 'SETE_SEIS', 'BALIZA_VAZIA'];
export const ROTULO_SITUACAO_NUMERICA = {
  SUPERIORIDADE: 'Superioridade',
  IGUALDADE: 'Igualdade',
  INFERIORIDADE: 'Inferioridade',
  SETE_SEIS: 'Ataque 7×6',
  BALIZA_VAZIA: 'Contra baliza vazia',
};

/** Sanções que ainda estão a decorrer neste segundo, com os segundos que faltam a cada uma. */
export function sancoesAtivas(suspensoes, segundo, duracao = DURACAO_SANCAO) {
  return (suspensoes ?? [])
    .filter((s) => s.segundoJogo <= segundo && segundo < s.segundoJogo + duracao)
    .map((s) => ({ ...s, restante: s.segundoJogo + duracao - segundo }))
    .sort((a, b) => a.restante - b.restante || a.eventoId - b.eventoId);
}

/** Quantos jogadores de campo a equipa tem a menos neste segundo (0, 1 ou 2). */
export function jogadoresAMenos(suspensoes, equipaId, segundo, duracao = DURACAO_SANCAO) {
  const ativas = sancoesAtivas(suspensoes, segundo, duracao).filter((s) => s.equipaId === equipaId).length;
  return Math.min(ativas, MAXIMO_A_MENOS);
}

/**
 * Como está o jogo neste segundo. Devolve null quando nada se passa (todos em campo, sem 7×6).
 * { ativas, aMenos: {equipaId: n}, favorecida: equipaId|null, rotulo: '6×5'|null, seteSeis: [equipaId] }
 * O rótulo diz quantos jogadores de campo tem cada equipa, começando pela que está em superioridade (ou pela casa, se há igualdade).
 */
export function situacaoAgora(numerica, casaId, foraId, segundo) {
  if (!numerica?.relogioUsado) return null;
  const duracao = numerica.duracaoSegundos ?? DURACAO_SANCAO;
  const ativas = sancoesAtivas(numerica.suspensoes, segundo, duracao);
  const seteSeis = (numerica.seteSeis ?? []).filter((e) => e.ativo).map((e) => e.equipaId);
  if (ativas.length === 0 && seteSeis.length === 0) return null;

  const aMenos = {
    [casaId]: jogadoresAMenos(numerica.suspensoes, casaId, segundo, duracao),
    [foraId]: jogadoresAMenos(numerica.suspensoes, foraId, segundo, duracao),
  };
  let favorecida = null;
  let rotulo = null;
  if (ativas.length > 0) {
    const [emCasa, emFora] = [6 - aMenos[casaId], 6 - aMenos[foraId]];
    if (emCasa === emFora) rotulo = `${emCasa}×${emFora}`;
    else {
      favorecida = emCasa > emFora ? casaId : foraId;
      rotulo = `${Math.max(emCasa, emFora)}×${Math.min(emCasa, emFora)}`;
    }
  }
  return { ativas, aMenos, favorecida, rotulo, seteSeis };
}

/**
 * Segundo de jogo "agora" a partir do relógio que o servidor mandou (relogio.segundo no momento recebidoEm, em ms).
 * Enquanto o relógio anda, o segundo avança com o tempo que passou desde que a mensagem chegou.
 */
export function segundoAgora(relogio, recebidoEm, agora = Date.now()) {
  if (!relogio) return 0;
  const extra = relogio.aCorrer && recebidoEm ? Math.max(0, Math.floor((agora - recebidoEm) / 1000)) : 0;
  return relogio.segundo + extra;
}

/** 72 -> "1:12" */
export function formatarRestante(segundos) {
  const s = Math.max(0, Math.ceil(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
