// Ligação em tempo real (SignalR / WebSockets) ao hub do jogo.
// A biblioteca global "signalR" vem de lib/signalr.min.js.

/**
 * Liga ao hub, entra no grupo do jogo e chama aoReceber(estado) com o estado atual
 * e depois a cada atualização. Volta a ligar sozinha se a rede cair.
 * O dono do jogo entra com a sessão; quem veio por um link de partilha passa o código.
 * aoMudarEstado recebe: 'ligado' | 'espera' | 'erro' | 'negado' (jogo que não existe ou sem acesso: não insiste).
 */
export function ligar(jogoId, codigo, aoReceber, aoMudarEstado) {
  const ligacao = new signalR.HubConnectionBuilder()
    .withUrl('/hub/jogo')
    .withAutomaticReconnect([0, 1000, 2000, 5000, 10000, 10000, 10000])
    .build();

  let negado = false;

  ligacao.on('EstatisticasAtualizadas', aoReceber);

  async function entrar() {
    const estado = await ligacao.invoke('EntrarNoJogo', jogoId, codigo ?? null);
    aoReceber(estado);
    aoMudarEstado('ligado');
  }

  /** Sem acesso ao jogo: pára de tentar e avisa a página. */
  function recusar(erro) {
    if (!String(erro?.message ?? erro).includes('Jogo não encontrado')) return false;
    negado = true;
    aoMudarEstado('negado');
    ligacao.stop().catch(() => {});
    return true;
  }

  async function iniciar() {
    if (negado) return;
    aoMudarEstado('espera');
    try {
      if (ligacao.state === signalR.HubConnectionState.Disconnected) await ligacao.start();
      await entrar();
    } catch (erro) {
      if (recusar(erro)) return;
      console.warn('Falha ao ligar ao hub:', erro);
      aoMudarEstado('erro');
      setTimeout(iniciar, 3000);
    }
  }

  ligacao.onreconnecting(() => aoMudarEstado('espera'));
  ligacao.onreconnected(async () => {
    try { await entrar(); } catch (erro) { if (!recusar(erro)) aoMudarEstado('erro'); }
  });
  // Esgotadas as tentativas automáticas, tenta de novo de 3 em 3 segundos
  ligacao.onclose(() => {
    if (negado) return;
    aoMudarEstado('erro');
    setTimeout(iniciar, 3000);
  });

  iniciar();
  return ligacao;
}

export const TEXTO_ESTADO = { ligado: 'em direto', espera: 'a ligar…', erro: 'sem ligação', negado: 'sem acesso' };
