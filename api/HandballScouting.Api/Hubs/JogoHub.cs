using Microsoft.AspNetCore.SignalR;

namespace HandballScouting.Api.Hubs;

/// <summary>
/// Hub SignalR (WebSockets). Cada jogo tem um grupo; quem entra recebe o estado atual
/// e depois a mensagem "EstatisticasAtualizadas" sempre que um evento é registado ou apagado.
/// Só entra quem for dono do jogo (cookie de sessão) ou trouxer o código do link de partilha.
/// </summary>
public class JogoHub(EstatisticasService estatisticas, AcessoService acesso, ContaService contas) : Hub
{
    public static string Grupo(int jogoId) => $"jogo-{jogoId}";

    public async Task<EstatisticasJogo> EntrarNoJogo(int jogoId, string? codigo)
    {
        var ct = Context.ConnectionAborted;
        var http = Context.GetHttpContext();
        // A sessão é lida de novo em cada entrada (e não guardada na ligação): sair da conta tem efeito logo
        var conta = http is null ? null : await contas.DaSessaoAsync(Autenticacao.LerToken(http.Request), ct);

        if (!await acesso.PodeVerJogoAsync(jogoId, codigo, conta?.Id, ct))
            throw new HubException("Jogo não encontrado.");

        var estado = await estatisticas.ObterAsync(jogoId, ct)
                     ?? throw new HubException("Jogo não encontrado.");
        await Groups.AddToGroupAsync(Context.ConnectionId, Grupo(jogoId));
        return estado;
    }

    public Task SairDoJogo(int jogoId) =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, Grupo(jogoId));
}
