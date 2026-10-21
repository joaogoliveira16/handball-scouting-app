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

    /// <summary>
    /// Os números dos jogadores de uma equipa da conta: o plantel, os jogos já registados e uma linha por jogador e jogo.
    /// Null se a equipa não existir ou for de outra conta.
    /// </summary>
    public async Task<EstatisticasEquipa?> EquipaAsync(int donoId, int equipaId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        if (!await con.ExecuteScalarAsync<bool>(new CommandDefinition(sql["equipa_existe"], new { equipaId, donoId }, cancellationToken: ct)))
            return null;
        var p = new { equipaId, donoId };
        return new EstatisticasEquipa
        {
            EquipaId = equipaId,
            Plantel = (await Consulta<JogadorEquipa>(con, "jogadores_da_equipa", new { equipaId }, ct)).ToList(),
            Jogos = (await Consulta<JogoDaEquipa>(con, "equipa_jogos", p, ct)).ToList(),
            Linhas = (await Consulta<JogadorNoJogo>(con, "equipa_jogadores_por_jogo", p, ct)).ToList(),
        };
    }

    /// <summary>Os jogos que estão a ser registados agora e que o dono não escondeu (para a área de convidado).</summary>
    public async Task<List<JogoEmDireto>> JogosEmDiretoAsync(CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        return (await Consulta<JogoEmDireto>(con, "jogos_em_direto", new { minutos = JanelasEmDireto.Minutos }, ct)).ToList();
    }

    /// <summary>A imagem do escudo de uma equipa (null se a equipa não tem escudo).</summary>
    public async Task<EscudoImagem?> EscudoAsync(int equipaId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        return await con.QuerySingleOrDefaultAsync<EscudoImagem>(
            new CommandDefinition(sql["escudo_obter"], new { equipaId }, cancellationToken: ct));
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
        var estatisticas = new EstatisticasJogo
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
            OutrosEventosPorParte = (await Consulta<OutroEventoParte>(con, "outros_eventos_por_parte", p, ct)).ToList(),
            Sancoes = (await Consulta<SancaoJogador>(con, "sancoes", p, ct)).ToList(),
            UltimosEventos = (await Consulta<EventoResumo>(con, "ultimos_eventos", new { jogoId, limite = 15 }, ct)).ToList(),
            Remates = (await Consulta<RemateMapa>(con, "remates_mapa", p, ct)).ToList(),
            TerminadoEm = await con.ExecuteScalarAsync<DateTime?>(new CommandDefinition(sql["jogo_terminado"], p, cancellationToken: ct))
        };

        // Relógio: o que o tablet do banco avisou; sem aviso (jogos antigos), vale o último evento registado
        var relogio = await con.QuerySingleOrDefaultAsync<RelogioJogo>(
            new CommandDefinition(sql["relogio_obter"], p, cancellationToken: ct));
        var ultimoEvento = await con.ExecuteScalarAsync<int>(
            new CommandDefinition(sql["ultimo_segundo"], p, cancellationToken: ct));
        estatisticas.Relogio = relogio ?? new RelogioJogo { Segundo = ultimoEvento };

        estatisticas.Numerica = Numerica.Calcular(
            equipas[0].EquipaId, equipas[1].EquipaId,
            (await Consulta<SuspensaoJogo>(con, "suspensoes", p, ct)).ToList(),
            (await Consulta<SeteSeisEvento>(con, "sete_seis", p, ct)).ToList(),
            estatisticas.Remates, estatisticas.Relogio.Segundo,
            relogioUsado: relogio is not null || ultimoEvento > 0);

        // Treinador-assistente: regras sobre tudo o que acima ficou calculado
        estatisticas.Assistente = Assistente.Calcular(
            estatisticas, (await Consulta<TimeoutJogo>(con, "timeouts", p, ct)).ToList());
        return estatisticas;
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
