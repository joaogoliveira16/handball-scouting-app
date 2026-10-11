using Microsoft.AspNetCore.SignalR;

namespace HandballScouting.Api.Hubs;

/// <summary>
/// Hub SignalR (WebSockets). Cada jogo tem um grupo; quem entra recebe o estado atual
/// e depois a mensagem "EstatisticasAtualizadas" sempre que um evento é registado ou apagado.
/// </summary>
public class JogoHub(EstatisticasService estatisticas) : Hub
{
    public static string Grupo(int jogoId) => $"jogo-{jogoId}";

    public async Task<EstatisticasJogo> EntrarNoJogo(int jogoId)
    {
        var estado = await estatisticas.ObterAsync(jogoId, Context.ConnectionAborted)
                     ?? throw new HubException("Jogo não encontrado.");
        await Groups.AddToGroupAsync(Context.ConnectionId, Grupo(jogoId));
        return estado;
    }

    public Task SairDoJogo(int jogoId) =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, Grupo(jogoId));
}
