// Os dois marcos do relógio do banco: aos 30:00 da 1.ª parte é o intervalo e aos 60:00 da 2.ª parte é o fim do jogo.
// Quando o relógio os atinge, pára nesse segundo e o banco oferece o relatório (o do intervalo ou o do jogo todo).
// Cada marco dispara uma só vez: o banco guarda no relógio quais já foram atingidos (`avisados`).

export const SEGUNDOS_INTERVALO = 30 * 60;
export const SEGUNDOS_FIM = 60 * 60;

/**
 * O marco que o relógio acabou de atingir ('intervalo', 'fim') ou null.
 * `parte` é a parte do jogo em que o relógio está e `avisados` os marcos que já dispararam ({ intervalo, fim }).
 */
export function marcoAtingido(parte, segundos, avisados = {}) {
  if (parte === 1 && segundos >= SEGUNDOS_INTERVALO && !avisados.intervalo) return 'intervalo';
  if (parte === 2 && segundos >= SEGUNDOS_FIM && !avisados.fim) return 'fim';
  return null;
}

/**
 * Os marcos que já ficaram para trás num relógio que acabou de ser lido ou acertado à mão: esses não disparam
 * (quem acerta o relógio para o minuto 35 não quer que o banco volte aos 30:00 a dizer que é intervalo).
 */
export function marcosPassados(parte, segundos) {
  return { intervalo: parte !== 1 || segundos >= SEGUNDOS_INTERVALO, fim: segundos >= SEGUNDOS_FIM };
}

/** O segundo em que o relógio pára para cada marco. */
export const SEGUNDO_DO_MARCO = { intervalo: SEGUNDOS_INTERVALO, fim: SEGUNDOS_FIM };

/** O que o banco diz em cada marco: título, nota, ligação do relatório (parte do relatório e rótulo) e ação principal. */
export const TEXTO_MARCO = {
  intervalo: {
    titulo: 'Intervalo',
    nota: '30:00 · relógio parado. O relatório da 1.ª parte está pronto.',
    relatorio: { parte: '1', rotulo: 'Ver relatório do intervalo' },
    acao: 'Passar à 2.ª parte',
  },
  fim: {
    titulo: 'Fim do jogo',
    nota: '60:00 · relógio parado. O relatório do jogo todo está pronto.',
    relatorio: { parte: 'jogo', rotulo: 'Ver relatório do jogo' },
    acao: 'Terminar jogo',
  },
};

/** A ligação do relatório de um marco (abre a folha do jogo, na parte certa). */
export function ligacaoRelatorio(marco, jogoId) {
  return `intervalo.html?jogo=${jogoId}&parte=${TEXTO_MARCO[marco].relatorio.parte}`;
}
