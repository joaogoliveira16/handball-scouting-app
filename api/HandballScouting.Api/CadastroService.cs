using Dapper;
using Npgsql;

namespace HandballScouting.Api;

/// <summary>Equipas, jogadores, jogos e convocatórias.</summary>
public class CadastroService(NpgsqlDataSource dados, SqlLoader sql)
{
    private const string ViolacaoUnicidade = "23505";
    private const string ViolacaoChaveEstrangeira = "23503";

    private static CommandDefinition Cmd(string texto, object? parametros, CancellationToken ct) =>
        new(texto, parametros, cancellationToken: ct);

    // ------------------------- Equipas -------------------------

    public async Task<List<EquipaLinha>> EquipasAsync(int donoId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        return (await con.QueryAsync<EquipaLinha>(Cmd(sql["equipas"], new { donoId }, ct))).ToList();
    }

    public async Task<ResultadoRegisto> CriarEquipaAsync(int donoId, NovaEquipaRequest pedido, CancellationToken ct = default)
    {
        var erros = CadastroValidador.ValidarEquipa(pedido);
        if (erros.Count > 0) return ResultadoRegisto.Falha(400, string.Join(" ", erros));

        await using var con = await dados.OpenConnectionAsync(ct);
        try
        {
            var id = await con.ExecuteScalarAsync<int>(Cmd(sql["inserir_equipa"], new { nome = pedido.Nome!.Trim(), donoId }, ct));
            return ResultadoRegisto.Sucesso(id);
        }
        catch (PostgresException e) when (e.SqlState == ViolacaoUnicidade)
        {
            return ResultadoRegisto.Falha(409, "Já existe uma equipa com esse nome.");
        }
    }

    // ------------------------- Jogadores -------------------------

    /// <summary>Plantel da equipa (null se a equipa não existir ou for de outra conta).</summary>
    public async Task<List<JogadorEquipa>?> JogadoresDaEquipaAsync(int donoId, int equipaId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        if (!await con.ExecuteScalarAsync<bool>(Cmd(sql["equipa_existe"], new { equipaId, donoId }, ct))) return null;
        return (await con.QueryAsync<JogadorEquipa>(Cmd(sql["jogadores_da_equipa"], new { equipaId }, ct))).ToList();
    }

    public async Task<ResultadoRegisto> CriarJogadorAsync(int donoId, int equipaId, JogadorRequest pedido, CancellationToken ct = default)
    {
        var erros = CadastroValidador.ValidarJogador(pedido);
        if (erros.Count > 0) return ResultadoRegisto.Falha(400, string.Join(" ", erros));

        await using var con = await dados.OpenConnectionAsync(ct);
        if (!await con.ExecuteScalarAsync<bool>(Cmd(sql["equipa_existe"], new { equipaId, donoId }, ct)))
            return ResultadoRegisto.Falha(404, "Equipa não encontrada.");
        try
        {
            var id = await con.ExecuteScalarAsync<int>(Cmd(sql["inserir_jogador"], new
            {
                equipaId, numero = pedido.Numero, nome = pedido.Nome!.Trim(), posicao = pedido.Posicao
            }, ct));
            return ResultadoRegisto.Sucesso(id);
        }
        catch (PostgresException e) when (e.SqlState == ViolacaoUnicidade)
        {
            return ResultadoRegisto.Falha(409, "Já existe um jogador com esse número nesta equipa.");
        }
    }

    public async Task<ResultadoRegisto> AtualizarJogadorAsync(int donoId, int jogadorId, JogadorRequest pedido, CancellationToken ct = default)
    {
        var erros = CadastroValidador.ValidarJogador(pedido);
        if (erros.Count > 0) return ResultadoRegisto.Falha(400, string.Join(" ", erros));

        await using var con = await dados.OpenConnectionAsync(ct);
        try
        {
            var linhas = await con.ExecuteAsync(Cmd(sql["atualizar_jogador"], new
            {
                jogadorId, donoId, numero = pedido.Numero, nome = pedido.Nome!.Trim(), posicao = pedido.Posicao
            }, ct));
            return linhas > 0 ? ResultadoRegisto.Atualizado() : ResultadoRegisto.Falha(404, "Jogador não encontrado.");
        }
        catch (PostgresException e) when (e.SqlState == ViolacaoUnicidade)
        {
            return ResultadoRegisto.Falha(409, "Já existe um jogador com esse número nesta equipa.");
        }
    }

    public async Task<ResultadoRegisto> ApagarJogadorAsync(int donoId, int jogadorId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        try
        {
            var linhas = await con.ExecuteAsync(Cmd(sql["apagar_jogador"], new { jogadorId, donoId }, ct));
            return linhas > 0 ? ResultadoRegisto.Atualizado() : ResultadoRegisto.Falha(404, "Jogador não encontrado.");
        }
        catch (PostgresException e) when (e.SqlState == ViolacaoChaveEstrangeira)
        {
            return ResultadoRegisto.Falha(409, "Este jogador tem eventos registados e não pode ser apagado.");
        }
    }

    // ------------------------- Jogos e convocatória -------------------------

    public async Task<ResultadoRegisto> CriarJogoAsync(int donoId, NovoJogoRequest pedido, CancellationToken ct = default)
    {
        var erros = CadastroValidador.ValidarJogo(pedido);
        if (erros.Count > 0) return ResultadoRegisto.Falha(400, string.Join(" ", erros));

        await using var con = await dados.OpenConnectionAsync(ct);
        foreach (var equipaId in new[] { pedido.CasaId, pedido.ForaId })
        {
            if (!await con.ExecuteScalarAsync<bool>(Cmd(sql["equipa_existe"], new { equipaId, donoId }, ct)))
                return ResultadoRegisto.Falha(400, $"a equipa {equipaId} não existe.");
        }

        var local = string.IsNullOrWhiteSpace(pedido.Local) ? null : pedido.Local.Trim();
        // O Npgsql só aceita DateTimeOffset com desvio 0 (UTC) em colunas timestamptz
        var dataHora = pedido.DataHora?.ToUniversalTime();
        var id = await con.ExecuteScalarAsync<int>(Cmd(sql["inserir_jogo"], new
        {
            casaId = pedido.CasaId, foraId = pedido.ForaId, dataHora, local, donoId
        }, ct));
        return ResultadoRegisto.Sucesso(id);
    }

    public async Task<List<int>?> ConvocadosAsync(int donoId, int jogoId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        if (!await con.ExecuteScalarAsync<bool>(Cmd(sql["jogo_do_dono"], new { jogoId, donoId }, ct)))
            return null;
        return (await con.QueryAsync<int>(Cmd(sql["convocados_ids"], new { jogoId }, ct))).ToList();
    }

    /// <summary>Substitui a convocatória do jogo (lista vazia = sem convocatória).</summary>
    /// <summary>O dono mostra ou esconde o jogo na lista de jogos em direto da área de convidado.</summary>
    public async Task<ResultadoRegisto> DefinirVisibilidadeAsync(int donoId, int jogoId, VisibilidadeRequest pedido, CancellationToken ct = default)
    {
        if (pedido.Visivel is not { } visivel) return ResultadoRegisto.Falha(400, "visivel é obrigatório (true ou false).");
        await using var con = await dados.OpenConnectionAsync(ct);
        var id = await con.QuerySingleOrDefaultAsync<int?>(Cmd(sql["definir_visibilidade"], new { jogoId, donoId, visivel }, ct));
        return id is null ? ResultadoRegisto.Falha(404, "Jogo não encontrado.") : ResultadoRegisto.Atualizado();
    }

    public async Task<ResultadoRegisto> DefinirConvocadosAsync(int donoId, int jogoId, ConvocatoriaRequest pedido, CancellationToken ct = default)
    {
        if (pedido.JogadorIds is null) return ResultadoRegisto.Falha(400, "jogadorIds é obrigatório.");
        var ids = pedido.JogadorIds.Distinct().ToArray();

        await using var con = await dados.OpenConnectionAsync(ct);
        var jogo = await con.QuerySingleOrDefaultAsync<JogoEquipas>(Cmd(sql["jogo_equipas"], new { jogoId, donoId }, ct));
        if (jogo is null) return ResultadoRegisto.Falha(404, "Jogo não encontrado.");

        var existentes = ids.Length == 0
            ? new List<JogadorBasico>()
            : (await con.QueryAsync<JogadorBasico>(Cmd(sql["jogadores_basico"], new { ids }, ct))).ToList();

        var erros = CadastroValidador.ValidarConvocatoria(ids, existentes, jogo.CasaId, jogo.ForaId);
        if (erros.Count > 0) return ResultadoRegisto.Falha(400, string.Join(" ", erros));

        // Com a lista vazia a instrução "IN" ficaria sem valores: basta apagar
        if (ids.Length == 0)
            await con.ExecuteAsync(Cmd("DELETE FROM convocados WHERE jogo_id = @jogoId", new { jogoId }, ct));
        else
            await con.ExecuteAsync(Cmd(sql["substituir_convocados"], new { jogoId, ids }, ct));

        return ResultadoRegisto.Atualizado();
    }
}
