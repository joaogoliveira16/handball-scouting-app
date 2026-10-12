using Dapper;
using Npgsql;

namespace HandballScouting.Api;

/// <summary>Registo e remoção de eventos de jogo.</summary>
public class EventosService(NpgsqlDataSource dados, SqlLoader sql)
{
    public async Task<ResultadoRegisto> RegistarAsync(int donoId, int jogoId, NovoEventoRequest req, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);

        var jogo = await con.QuerySingleOrDefaultAsync<JogoEquipas>(
            new CommandDefinition(sql["jogo_equipas"], new { jogoId, donoId }, cancellationToken: ct));
        if (jogo is null)
            return ResultadoRegisto.Falha(404, "Jogo não encontrado.");

        if (req.EquipaId != jogo.CasaId && req.EquipaId != jogo.ForaId)
            return ResultadoRegisto.Falha(400, "equipaId não pertence a este jogo.");

        var tipo = await con.QuerySingleOrDefaultAsync<TipoEvento>(
            new CommandDefinition(sql["tipo_evento"], new { codigo = req.TipoEvento }, cancellationToken: ct));
        if (tipo is null)
            return ResultadoRegisto.Falha(400, $"tipoEvento '{req.TipoEvento}' não existe.");

        var erros = EventoValidador.Validar(req, tipo.ERemate);
        if (erros.Count > 0)
            return ResultadoRegisto.Falha(400, string.Join(" ", erros));

        // Jogador tem de ser da equipa; guarda-redes tem de ser o GR da equipa adversária
        var ids = new[] { req.JogadorId, req.GuardaRedesId }.OfType<int>().Distinct().ToArray();
        if (ids.Length > 0)
        {
            var jogadores = (await con.QueryAsync<JogadorBasico>(
                new CommandDefinition(sql["jogadores_basico"], new { ids }, cancellationToken: ct)))
                .ToDictionary(j => j.Id);

            if (req.JogadorId is int jid &&
                (!jogadores.TryGetValue(jid, out var jogador) || jogador.EquipaId != req.EquipaId))
                return ResultadoRegisto.Falha(400, "jogadorId não pertence à equipa do evento.");

            if (req.GuardaRedesId is int gid &&
                (!jogadores.TryGetValue(gid, out var gr) || gr.EquipaId == req.EquipaId || gr.PosicaoCodigo != "GR"))
                return ResultadoRegisto.Falha(400, "guardaRedesId tem de ser o guarda-redes da equipa adversária.");
        }

        var id = await con.ExecuteScalarAsync<long>(new CommandDefinition(sql["inserir_evento"], new
        {
            jogoId,
            equipaId = req.EquipaId,
            tipo = req.TipoEvento,
            jogadorId = req.JogadorId,
            guardaRedesId = req.GuardaRedesId,
            resultado = req.Resultado,
            situacao = req.Situacao ?? "POSICIONAL",
            x = req.X,
            y = req.Y,
            parte = req.Parte,
            segundoJogo = req.SegundoJogo,
            balizaX = req.BalizaX,
            balizaY = req.BalizaY
        }, cancellationToken: ct));

        return ResultadoRegisto.Sucesso(id);
    }

    public async Task<bool> ApagarAsync(int donoId, int jogoId, long eventoId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        var linhas = await con.ExecuteAsync(
            new CommandDefinition(sql["apagar_evento"], new { jogoId, eventoId, donoId }, cancellationToken: ct));
        return linhas > 0;
    }
}
