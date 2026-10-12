using Dapper;
using Npgsql;

namespace HandballScouting.Api;

/// <summary>Quem pode ver um jogo: o dono (com sessão) ou quem tem o código do link de partilha.</summary>
public class AcessoService(NpgsqlDataSource dados, SqlLoader sql)
{
    public async Task<bool> PodeVerJogoAsync(int jogoId, string? codigo, int? utilizadorId, CancellationToken ct = default)
    {
        // sem sessão e sem código não há nada a verificar (e um código vazio nunca corresponde a nenhum jogo)
        if (utilizadorId is null && string.IsNullOrWhiteSpace(codigo)) return false;
        await using var con = await dados.OpenConnectionAsync(ct);
        return await con.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql["jogo_acessivel"], new { jogoId, utilizadorId, codigo = string.IsNullOrWhiteSpace(codigo) ? null : codigo }, cancellationToken: ct));
    }
}
