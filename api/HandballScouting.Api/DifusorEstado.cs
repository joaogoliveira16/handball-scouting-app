using HandballScouting.Api.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace HandballScouting.Api;

/// <summary>
/// Envia o estado atualizado de um jogo aos ecrãs ligados (dashboards e bancos), fora do pedido que o mudou.
/// O pedido (registar, corrigir ou apagar um evento...) responde logo depois de gravar e o cálculo das estatísticas
/// corre a seguir, em segundo plano. Se chegarem vários avisos do mesmo jogo enquanto um envio está a decorrer
/// (a fila do banco a esvaziar-se depois de voltar a rede), juntam-se num só envio no fim, que já leva tudo:
/// o último estado enviado é sempre o mais recente.
/// </summary>
public sealed class DifusorEstado(IServiceScopeFactory scopes, IHubContext<JogoHub> hub, ILogger<DifusorEstado> registo)
{
    private readonly object _trinco = new();
    // Jogos com um envio a decorrer; o valor diz se chegou outro aviso entretanto (e é preciso enviar outra vez)
    private readonly Dictionary<int, bool> _aEnviar = new();

    /// <summary>Pede um envio do estado deste jogo. Não espera pelo envio.</summary>
    public void Agendar(int jogoId)
    {
        lock (_trinco)
        {
            if (_aEnviar.ContainsKey(jogoId))
            {
                _aEnviar[jogoId] = true;
                return;
            }
            _aEnviar[jogoId] = false;
        }
        _ = Task.Run(() => EnviarAsync(jogoId));
    }

    private async Task EnviarAsync(int jogoId)
    {
        while (true)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var est = scope.ServiceProvider.GetRequiredService<EstatisticasService>();
                var estado = await est.ObterAsync(jogoId);
                if (estado is not null)
                    await hub.Clients.Group(JogoHub.Grupo(jogoId)).SendAsync("EstatisticasAtualizadas", estado);
            }
            catch (Exception e)
            {
                registo.LogWarning(e, "Não foi possível enviar o estado do jogo {JogoId} aos ecrãs ligados.", jogoId);
            }

            lock (_trinco)
            {
                if (!_aEnviar[jogoId])
                {
                    _aEnviar.Remove(jogoId);
                    return;
                }
                _aEnviar[jogoId] = false;   // houve outro aviso durante o envio: volta a enviar, já com ele
            }
        }
    }
}
