// Ligação em tempo real (SignalR / WebSockets) ao hub do jogo.
// A biblioteca global "signalR" vem de lib/signalr.min.js.

/**
 * Liga ao hub, entra no grupo do jogo e chama aoReceber(estado) com o estado atual
 * e depois a cada atualização. Volta a ligar sozinha se a rede cair.
 * aoMudarEstado recebe: 'ligado' | 'espera' | 'erro'.
 */
export function ligar(jogoId, aoReceber, aoMudarEstado) {
  const ligacao = new signalR.HubConnectionBuilder()
    .withUrl('/hub/jogo')
    .withAutomaticReconnect([0, 1000, 2000, 5000, 10000, 10000, 10000])
    .build();

  ligacao.on('EstatisticasAtualizadas', aoReceber);

  async function entrar() {
    const estado = await ligacao.invoke('EntrarNoJogo', jogoId);
    aoReceber(estado);
    aoMudarEstado('ligado');
  }

  async function iniciar() {
    aoMudarEstado('espera');
    try {
      await ligacao.start();
      await entrar();
    } catch (erro) {
      console.warn('Falha ao ligar ao hub:', erro);
      aoMudarEstado('erro');
      setTimeout(iniciar, 3000);
    }
  }

  ligacao.onreconnecting(() => aoMudarEstado('espera'));
  ligacao.onreconnected(async () => {
    try { await entrar(); } catch { aoMudarEstado('erro'); }
  });
  // Esgotadas as tentativas automáticas, tenta de novo de 3 em 3 segundos
  ligacao.onclose(() => { aoMudarEstado('erro'); setTimeout(iniciar, 3000); });

  iniciar();
  return ligacao;
}

export const TEXTO_ESTADO = { ligado: 'em direto', espera: 'a ligar…', erro: 'sem ligação' };
