// Time-out: o relógio de jogo pára e conta-se 1 minuto à parte (o tempo do time-out), a descontar até zero.
// O banco guarda `{ ate, equipaId }` junto do relógio: `ate` é a hora (em ms) a que o minuto acaba.

export const DURACAO_TIMEOUT_S = 60;

/** Depois de acabar o minuto, a faixa fica à espera do «Retomar o jogo»; ao fim de tanto tempo desiste (tablet esquecido). */
const ESQUECIDO_DEPOIS_S = 300;

/** Um time-out que começa agora. */
export function novoTimeout(equipaId, agora = Date.now(), duracaoSegundos = DURACAO_TIMEOUT_S) {
  return { ate: agora + duracaoSegundos * 1000, equipaId };
}

/**
 * Como está o time-out agora: `{ restante, acabou }` (restante em segundos, arredondado para cima, 0 quando acabou)
 * ou null se não há time-out (ou ficou esquecido há muito tempo).
 */
export function estadoTimeout(timeout, agora = Date.now()) {
  if (!timeout || !Number.isFinite(timeout.ate)) return null;
  const falta = Math.ceil((timeout.ate - agora) / 1000);
  if (falta > 0) return { restante: falta, acabou: false };
  if (-falta > ESQUECIDO_DEPOIS_S) return null;
  return { restante: 0, acabou: true };
}
