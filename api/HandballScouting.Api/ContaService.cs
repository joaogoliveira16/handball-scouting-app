using System.Security.Cryptography;
using Dapper;
using Npgsql;

namespace HandballScouting.Api;

/// <summary>Resultado de registar ou entrar: a conta e o código da sessão (que vai para o cookie).</summary>
public record ResultadoConta(bool Ok, int Status, string? Erro, Utilizador? Utilizador = null, string? Token = null)
{
    public static ResultadoConta Falha(int status, string erro) => new(false, status, erro);
}

/// <summary>Contas e sessões. O cookie leva um código aleatório; na base de dados só fica o seu SHA-256.</summary>
public class ContaService(NpgsqlDataSource dados, SqlLoader sql, LimiteTentativas limite)
{
    public static readonly TimeSpan DuracaoSessao = TimeSpan.FromDays(30);
    private const string ViolacaoUnicidade = "23505";
    private const string MensagemEntrada = "Email ou palavra-passe errados.";

    private static CommandDefinition Cmd(string texto, object? parametros, CancellationToken ct) =>
        new(texto, parametros, cancellationToken: ct);

    public async Task<ResultadoConta> RegistarAsync(RegistoRequest pedido, CancellationToken ct = default)
    {
        var erros = ContaValidador.ValidarRegisto(pedido);
        if (erros.Count > 0) return ResultadoConta.Falha(400, string.Join(" ", erros));

        var email = ContaValidador.NormalizarEmail(pedido.Email);
        var nome = pedido.Nome!.Trim();
        var hash = PalavraPasse.Hash(pedido.PalavraPasse!);

        await using var con = await dados.OpenConnectionAsync(ct);
        int id;
        try
        {
            id = await con.ExecuteScalarAsync<int>(Cmd(sql["registar_utilizador"], new { email, nome, hash }, ct));
        }
        catch (PostgresException e) when (e.SqlState == ViolacaoUnicidade)
        {
            return ResultadoConta.Falha(409, "Já existe uma conta com esse email.");
        }

        var token = await CriarSessaoAsync(con, id, ct);
        return new ResultadoConta(true, 201, null, new Utilizador { Id = id, Nome = nome, Email = email }, token);
    }

    public async Task<ResultadoConta> EntrarAsync(EntrarRequest pedido, CancellationToken ct = default)
    {
        var email = ContaValidador.NormalizarEmail(pedido.Email);
        var palavraPasse = pedido.PalavraPasse ?? "";
        if (email.Length == 0 || palavraPasse.Length == 0 || palavraPasse.Length > ContaValidador.MaxPalavraPasse)
            return ResultadoConta.Falha(401, MensagemEntrada);

        if (limite.Bloqueado(email))
            return ResultadoConta.Falha(429, "Demasiadas tentativas falhadas. Tenta outra vez daqui a alguns minutos.");

        await using var con = await dados.OpenConnectionAsync(ct);
        var conta = await con.QuerySingleOrDefaultAsync<UtilizadorComHash>(Cmd(sql["utilizador_por_email"], new { email }, ct));
        if (conta is null)
        {
            PalavraPasse.GastarTempo(palavraPasse);   // demora o mesmo que quando o email existe
            limite.RegistarFalha(email);
            return ResultadoConta.Falha(401, MensagemEntrada);
        }
        if (!PalavraPasse.Verificar(palavraPasse, conta.PalavraPasseHash))
        {
            limite.RegistarFalha(email);
            return ResultadoConta.Falha(401, MensagemEntrada);
        }

        limite.Limpar(email);
        var token = await CriarSessaoAsync(con, conta.Id, ct);
        return new ResultadoConta(true, 200, null, new Utilizador { Id = conta.Id, Nome = conta.Nome, Email = conta.Email }, token);
    }

    private async Task<string> CriarSessaoAsync(NpgsqlConnection con, int utilizadorId, CancellationToken ct)
    {
        await con.ExecuteAsync(Cmd(sql["limpar_sessoes"], null, ct));   // aproveita para apagar as sessões que já expiraram
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        await con.ExecuteAsync(Cmd(sql["criar_sessao"], new
        {
            tokenHash = PalavraPasse.HashDoToken(token), utilizadorId, expiraEm = DateTime.UtcNow + DuracaoSessao
        }, ct));
        return token;
    }

    /// <summary>A conta a que pertence o código do cookie (null se não existir ou se já expirou).</summary>
    public async Task<Utilizador?> DaSessaoAsync(string? token, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(token) || token.Length != 64) return null;
        await using var con = await dados.OpenConnectionAsync(ct);
        return await con.QuerySingleOrDefaultAsync<Utilizador>(Cmd(sql["utilizador_da_sessao"], new { tokenHash = PalavraPasse.HashDoToken(token) }, ct));
    }

    public async Task TerminarSessaoAsync(string? token, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(token) || token.Length != 64) return;
        await using var con = await dados.OpenConnectionAsync(ct);
        await con.ExecuteAsync(Cmd(sql["apagar_sessao"], new { tokenHash = PalavraPasse.HashDoToken(token) }, ct));
    }
}
