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
    public async Task<EstatisticasEquipa?> EquipaAsync(int donoId, int equipaId, short? parte = null, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        if (!await con.ExecuteScalarAsync<bool>(new CommandDefinition(sql["equipa_existe"], new { equipaId, donoId }, cancellationToken: ct)))
            return null;
        var p = new { equipaId, donoId, parte };   // parte: 1 ou 2 conta só essa parte; null conta o jogo todo
        return new EstatisticasEquipa
        {
            EquipaId = equipaId,
            Plantel = (await Consulta<JogadorEquipa>(con, "jogadores_da_equipa", new { equipaId }, ct)).ToList(),
            Jogos = (await Consulta<JogoDaEquipa>(con, "equipa_jogos", p, ct)).ToList(),
            Linhas = (await Consulta<JogadorNoJogo>(con, "equipa_jogadores_por_jogo", p, ct)).ToList(),
        };
    }

    /// <summary>
    /// O que se sabe de uma equipa (normalmente a do próximo adversário) pelos jogos registados da conta: o plantel, os
    /// jogos, os remates dela e dos adversários e os outros eventos. Null se a equipa não existir ou for de outra conta.
    /// </summary>
    public async Task<DadosDoAdversario?> AdversarioAsync(int donoId, int equipaId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        var nome = await con.ExecuteScalarAsync<string?>(new CommandDefinition(sql["equipa_nome"], new { equipaId, donoId }, cancellationToken: ct));
        if (nome is null) return null;
        var p = new { equipaId, donoId };
        return new DadosDoAdversario
        {
            EquipaId = equipaId,
            Nome = nome,
            Jogadores = (await Consulta<JogadorEquipa>(con, "jogadores_da_equipa", new { equipaId }, ct)).ToList(),
            Jogos = (await Consulta<JogoDaEquipa>(con, "equipa_jogos", new { equipaId, donoId, parte = (short?)null }, ct)).ToList(),
            Remates = (await Consulta<RemateDoAdversario>(con, "adversario_remates", p, ct)).ToList(),
            OutrosEventos = (await Consulta<OutroEventoDoJogo>(con, "adversario_outros", p, ct)).ToList(),
        };
    }

    /// <summary>O nome de uma equipa da conta; null se a equipa não existir ou for de outra conta.</summary>
    public async Task<string?> NomeDaEquipaAsync(int donoId, int equipaId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        return await con.ExecuteScalarAsync<string?>(new CommandDefinition(sql["equipa_nome"], new { equipaId, donoId }, cancellationToken: ct));
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

    /// <summary>As consultas do estado de um jogo, pela ordem em que se lêem em <see cref="ObterAsync"/>.</summary>
    private static readonly string[] ConsultasDoEstado =
    [
        "equipas_resumo", "jogadores_stats", "por_corredor", "por_distancia", "por_parte", "guarda_redes", "parcial",
        "outros_eventos", "outros_eventos_por_parte", "sancoes", "ultimos_eventos", "remates_mapa", "jogo_terminado",
        "relogio_obter", "ultimo_segundo", "suspensoes", "sete_seis", "timeouts",
    ];

    /// <summary>Estado completo do jogo (null se o jogo não existir).</summary>
    public async Task<EstatisticasJogo?> ObterAsync(int jogoId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);

        // Todas as consultas seguem num só pedido à base de dados (em vez de uma ida e volta por consulta)
        await using var r = await con.QueryMultipleAsync(new CommandDefinition(sql.Juntas(ConsultasDoEstado),
            new { jogoId, minutos = ParcialMinutos, limite = 15 }, cancellationToken: ct));

        var equipas = (await r.ReadAsync<ResumoEquipa>()).ToList();
        if (equipas.Count == 0) return null;

        var estatisticas = new EstatisticasJogo
        {
            JogoId = jogoId,
            AtualizadoEm = DateTimeOffset.UtcNow,
            Equipas = equipas,
            Jogadores = (await r.ReadAsync<EstatJogador>()).ToList(),
            PorCorredor = (await r.ReadAsync<EstatZona>()).ToList(),
            PorDistancia = (await r.ReadAsync<EstatZona>()).ToList(),
            PorParte = (await r.ReadAsync<EstatParte>()).ToList(),
            GuardaRedes = (await r.ReadAsync<EstatGuardaRedes>()).ToList(),
            ParcialMinutos = ParcialMinutos,
            Parcial = (await r.ReadAsync<ParcialEquipa>()).ToList(),
            OutrosEventos = (await r.ReadAsync<OutroEvento>()).ToList(),
            OutrosEventosPorParte = (await r.ReadAsync<OutroEventoParte>()).ToList(),
            Sancoes = (await r.ReadAsync<SancaoJogador>()).ToList(),
            UltimosEventos = (await r.ReadAsync<EventoResumo>()).ToList(),
            Remates = (await r.ReadAsync<RemateMapa>()).ToList(),
            TerminadoEm = await r.ReadSingleOrDefaultAsync<DateTime?>()
        };

        // Relógio: o que o tablet do banco avisou; sem aviso (jogos antigos), vale o último evento registado
        var relogio = await r.ReadSingleOrDefaultAsync<RelogioJogo>();
        var ultimoEvento = await r.ReadSingleOrDefaultAsync<int>();
        estatisticas.Relogio = relogio ?? new RelogioJogo { Segundo = ultimoEvento };

        estatisticas.Numerica = Numerica.Calcular(
            equipas[0].EquipaId, equipas[1].EquipaId,
            (await r.ReadAsync<SuspensaoJogo>()).ToList(),
            (await r.ReadAsync<SeteSeisEvento>()).ToList(),
            estatisticas.Remates, estatisticas.Relogio.Segundo,
            relogioUsado: relogio is not null || ultimoEvento > 0);

        // Treinador-assistente: regras sobre tudo o que acima ficou calculado
        estatisticas.Assistente = Assistente.Calcular(estatisticas, (await r.ReadAsync<TimeoutJogo>()).ToList());
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
