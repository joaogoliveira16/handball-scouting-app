using Dapper;
using Npgsql;

namespace HandballScouting.Api;

/// <summary>
/// Quem pode ver um jogo: o dono (com sessão), quem tem o código do link de partilha, ou qualquer pessoa se o jogo
/// está em direto e o dono não o escondeu da área de convidado.
/// </summary>
public class AcessoService(NpgsqlDataSource dados, SqlLoader sql)
{
    public async Task<bool> PodeVerJogoAsync(int jogoId, string? codigo, int? utilizadorId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        // um código vazio nunca corresponde a nenhum jogo
        return await con.ExecuteScalarAsync<bool>(new CommandDefinition(sql["jogo_acessivel"], new
        {
            jogoId, utilizadorId, codigo = string.IsNullOrWhiteSpace(codigo) ? null : codigo, minutosAberto = JanelasEmDireto.Minutos
        }, cancellationToken: ct));
    }

    /// <summary>O jogo existe e é desta conta?</summary>
    public async Task<bool> EDonoAsync(int jogoId, int donoId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        return await con.ExecuteScalarAsync<bool>(new CommandDefinition(sql["jogo_do_dono"], new { jogoId, donoId }, cancellationToken: ct));
    }
}
