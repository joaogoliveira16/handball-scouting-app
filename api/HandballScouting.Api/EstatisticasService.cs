using Dapper;
using Npgsql;

namespace HandballScouting.Api;

/// <summary>Consultas de agregação (GROUP BY / COUNT) que alimentam o dashboard.</summary>
public class EstatisticasService(NpgsqlDataSource dados, SqlLoader sql)
{
    /// <summary>Janela do parcial mostrado no dashboard (minutos de jogo).</summary>
    public const int ParcialMinutos = 5;

    private Task<IEnumerable<T>> Consulta<T>(NpgsqlConnection con, string nome, object? parametros, CancellationToken ct) =>
        con.QueryAsync<T>(new CommandDefinition(sql[nome], parametros, cancellationToken: ct));

    public async Task<List<TipoEvento>> TiposEventoAsync(CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        return (await Consulta<TipoEvento>(con, "tipos_evento", null, ct)).ToList();
    }

    /// <summary>Jogos de uma conta, do mais recente para o mais antigo.</summary>
    public async Task<List<JogoLinha>> JogosAsync(int donoId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        return (await Consulta<JogoLinha>(con, "jogos", new { donoId }, ct)).ToList();
    }

    public async Task<JogoDetalhe?> JogoAsync(int jogoId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        var jogo = await con.QuerySingleOrDefaultAsync<JogoDetalhe>(
            new CommandDefinition(sql["jogo"], new { jogoId }, cancellationToken: ct));
        if (jogo is null) return null;
        jogo.Jogadores = (await Consulta<JogadorInfo>(con, "jogadores_do_jogo", new { jogoId }, ct)).ToList();
        return jogo;
    }

    /// <summary>Estado completo do jogo (null se o jogo não existir).</summary>
    public async Task<EstatisticasJogo?> ObterAsync(int jogoId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        var p = new { jogoId };

        var equipas = (await Consulta<ResumoEquipa>(con, "equipas_resumo", p, ct)).ToList();
        if (equipas.Count == 0) return null;

        // A mesma ligação não corre comandos em paralelo, por isso as consultas são sequenciais
        return new EstatisticasJogo
        {
            JogoId = jogoId,
            AtualizadoEm = DateTimeOffset.UtcNow,
            Equipas = equipas,
            Jogadores = (await Consulta<EstatJogador>(con, "jogadores_stats", p, ct)).ToList(),
            PorCorredor = (await Consulta<EstatZona>(con, "por_corredor", p, ct)).ToList(),
            PorDistancia = (await Consulta<EstatZona>(con, "por_distancia", p, ct)).ToList(),
            PorParte = (await Consulta<EstatParte>(con, "por_parte", p, ct)).ToList(),
            GuardaRedes = (await Consulta<EstatGuardaRedes>(con, "guarda_redes", p, ct)).ToList(),
            ParcialMinutos = ParcialMinutos,
            Parcial = (await Consulta<ParcialEquipa>(con, "parcial", new { jogoId, minutos = ParcialMinutos }, ct)).ToList(),
            OutrosEventos = (await Consulta<OutroEvento>(con, "outros_eventos", p, ct)).ToList(),
            UltimosEventos = (await Consulta<EventoResumo>(con, "ultimos_eventos", new { jogoId, limite = 15 }, ct)).ToList(),
            Remates = (await Consulta<RemateMapa>(con, "remates_mapa", p, ct)).ToList()
        };
    }

    /// <summary>Tudo o que o ficheiro Excel precisa (null se o jogo não existir).</summary>
    public async Task<DadosExportacao?> ObterExportacaoAsync(int jogoId, CancellationToken ct = default)
    {
        var jogo = await JogoAsync(jogoId, ct);
        var estatisticas = jogo is null ? null : await ObterAsync(jogoId, ct);
        if (jogo is null || estatisticas is null) return null;

        await using var con = await dados.OpenConnectionAsync(ct);
        return new DadosExportacao
        {
            Jogo = jogo,
            Estatisticas = estatisticas,
            Eventos = (await Consulta<EventoExport>(con, "eventos_todos", new { jogoId }, ct)).ToList(),
            Tipos = (await Consulta<TipoEvento>(con, "tipos_evento", null, ct)).ToList()
        };
    }

    /// <summary>Eficácia de remate com filtros opcionais (jogador, posição, corredor, distância, parte...).</summary>
    public async Task<ResultadoEficacia> EficaciaAsync(int jogoId, FiltroRemates f, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        return await con.QuerySingleAsync<ResultadoEficacia>(new CommandDefinition(sql["eficacia_filtrada"], new
        {
            jogoId,
            equipaId = f.EquipaId,
            jogadorId = f.JogadorId,
            posicao = f.Posicao,
            corredor = f.Corredor,
            distancia = f.Distancia,
            parte = f.Parte,
            situacao = f.Situacao
        }, cancellationToken: ct));
    }

    /// <summary>Defesas dos guarda-redes com filtros opcionais (ex.: só remates das pontas).</summary>
    public async Task<List<EstatGuardaRedes>> GuardaRedesAsync(int jogoId, FiltroRemates f, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        return (await Consulta<EstatGuardaRedes>(con, "guarda_redes_filtrado", new
        {
            jogoId,
            jogadorId = f.JogadorId,
            corredor = f.Corredor,
            distancia = f.Distancia,
            parte = f.Parte,
            situacao = f.Situacao
        }, ct)).ToList();
    }
}
