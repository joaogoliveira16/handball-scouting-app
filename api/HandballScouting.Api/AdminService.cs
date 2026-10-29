using Dapper;
using Npgsql;

namespace HandballScouting.Api;

/// <summary>
/// A área de administração: ver todas as contas e jogos, desativar contas, mudar o papel, pedir a recuperação da
/// palavra-passe e corrigir ou apagar eventos de qualquer jogo. Cada ação deixa uma linha no registo de alterações.
/// A autorização (só admins) é das rotas /api/admin (ver <see cref="Autenticacao.ExigirAdmin"/>); aqui tratam-se as regras.
/// </summary>
public class AdminService(
    NpgsqlDataSource dados, SqlLoader sql, ContaService contas, EventosService eventos, EstatisticasService estatisticas,
    ILogger<AdminService> log)
{
    /// <summary>Quantas linhas do registo a página mostra.</summary>
    public const int LinhasDoRegisto = 200;

    private static CommandDefinition Cmd(string texto, object? parametros, CancellationToken ct) =>
        new(texto, parametros, cancellationToken: ct);

    // ------------------------------------------------------------------ contas

    public async Task<List<UtilizadorAdmin>> UtilizadoresAsync(CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        return (await con.QueryAsync<UtilizadorAdmin>(Cmd(sql["admin_utilizadores"], new { id = (int?)null }, ct))).ToList();
    }

    private static async Task<UtilizadorAdmin?> UtilizadorAsync(NpgsqlConnection con, SqlLoader sql, int id, CancellationToken ct) =>
        await con.QuerySingleOrDefaultAsync<UtilizadorAdmin>(Cmd(sql["admin_utilizadores"], new { id }, ct));

    /// <summary>Mudar o papel de outra conta. Ninguém muda o próprio papel, e a app nunca fica sem um admin ativo.</summary>
    public async Task<ResultadoAdmin> DefinirPapelAsync(Utilizador autor, int id, string? papel, CancellationToken ct = default)
    {
        if (!Papeis.Valido(papel)) return ResultadoAdmin.Falha(400, "O papel tem de ser «normal» ou «admin».");
        if (id == autor.Id) return ResultadoAdmin.Falha(400, "Não podes mudar o papel da tua própria conta.");

        await using var con = await dados.OpenConnectionAsync(ct);
        if (await UtilizadorAsync(con, sql, id, ct) is not { } alvo) return ResultadoAdmin.Falha(404, "Conta não encontrada.");
        if (alvo.Papel == papel) return ResultadoAdmin.Falha(409, $"Esta conta já é {Papeis.Rotulo(papel!)}.");
        if (papel == Papeis.Admin && alvo.Estado != EstadosConta.Ativo)
            return ResultadoAdmin.Falha(409, "Só uma conta ativa, com o email confirmado, pode ser admin.");

        var mudou = await con.ExecuteScalarAsync<int?>(Cmd(sql["admin_definir_papel"], new { id, papel }, ct));
        if (mudou is null) return ResultadoAdmin.Falha(409, "Tem de haver sempre pelo menos um admin ativo.");

        await RegistarAsync(con, autor, "conta", "Papel alterado", $"{alvo.Email}: {Papeis.Rotulo(alvo.Papel)} passou a {Papeis.Rotulo(papel!)}", null, ct);
        return ResultadoAdmin.Sucesso();
    }

    /// <summary>Desativar ou voltar a ativar outra conta. Desativar termina logo as sessões dela; os dados ficam.</summary>
    public async Task<ResultadoAdmin> DefinirAtivaAsync(Utilizador autor, int id, bool? ativa, CancellationToken ct = default)
    {
        if (ativa is null) return ResultadoAdmin.Falha(400, "Diz se a conta fica ativa ou desativada.");
        if (id == autor.Id) return ResultadoAdmin.Falha(400, "Não podes desativar a tua própria conta.");

        await using var con = await dados.OpenConnectionAsync(ct);
        if (await UtilizadorAsync(con, sql, id, ct) is not { } alvo) return ResultadoAdmin.Falha(404, "Conta não encontrada.");

        var mudou = await con.ExecuteScalarAsync<int?>(Cmd(sql["admin_definir_ativa"], new { id, ativa = ativa.Value }, ct));
        if (mudou is null) return ResultadoAdmin.Falha(409, ativa.Value ? "A conta já estava ativa." : "A conta já estava desativada.");

        if (!ativa.Value) await con.ExecuteAsync(Cmd(sql["apagar_sessoes_da_conta"], new { utilizadorId = id }, ct));
        await RegistarAsync(con, autor, "conta", ativa.Value ? "Conta ativada" : "Conta desativada", alvo.Email, null, ct);
        return ResultadoAdmin.Sucesso();
    }

    /// <summary>Envia à conta o link para escolher outra palavra-passe. O admin nunca vê nem escolhe a palavra-passe.</summary>
    public async Task<ResultadoAdmin> ReporPalavraPasseAsync(Utilizador autor, int id, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        if (await UtilizadorAsync(con, sql, id, ct) is not { } alvo) return ResultadoAdmin.Falha(404, "Conta não encontrada.");
        if (alvo.Estado == EstadosConta.Desativado) return ResultadoAdmin.Falha(409, "A conta está desativada: ativa-a primeiro.");

        switch (await contas.EnviarRedefinicaoAsync(id, ct))
        {
            case null: return ResultadoAdmin.Falha(404, "Conta não encontrada.");
            case false: return ResultadoAdmin.Falha(503, "Não foi possível enviar o email agora. Tenta outra vez daqui a pouco.");
        }
        await RegistarAsync(con, autor, "conta", "Ligação para repor a palavra-passe enviada", alvo.Email, null, ct);
        return ResultadoAdmin.Sucesso();
    }

    // ------------------------------------------------------------------ jogos e eventos

    public async Task<List<JogoAdmin>> JogosAsync(CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        return (await con.QueryAsync<JogoAdmin>(Cmd(sql["admin_jogos"], null, ct))).ToList();
    }

    private static async Task<DonoDoJogo?> DonoAsync(NpgsqlConnection con, SqlLoader sql, int jogoId, CancellationToken ct) =>
        await con.QuerySingleOrDefaultAsync<DonoDoJogo>(Cmd(sql["admin_dono_do_jogo"], new { jogoId }, ct));

    /// <summary>O jogo com o código de partilha e o nome da conta dona. Null se não existir ou não tiver dono.</summary>
    public async Task<JogoDetalheAdmin?> JogoAsync(int jogoId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        if (await DonoAsync(con, sql, jogoId, ct) is not { } dono) return null;
        return await estatisticas.JogoAsync(jogoId, ct) is { } jogo ? JogoDetalheAdmin.De(jogo, dono.DonoNome) : null;
    }

    /// <summary>Os eventos do jogo, como os vê o dono. Null se o jogo não existir.</summary>
    public async Task<List<EventoEditavel>?> EventosAsync(int jogoId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        return await DonoAsync(con, sql, jogoId, ct) is { } dono ? await eventos.ListarAsync(dono.DonoId, jogoId, ct) : null;
    }

    /// <summary>Corrige um evento de qualquer jogo (as mesmas regras do dono) e regista o que mudou.</summary>
    public async Task<ResultadoRegisto> CorrigirEventoAsync(
        Utilizador autor, int jogoId, long eventoId, NovoEventoRequest pedido, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        if (await DonoAsync(con, sql, jogoId, ct) is not { } dono) return ResultadoRegisto.Falha(404, "Jogo não encontrado.");
        var antes = (await eventos.ListarAsync(dono.DonoId, jogoId, ct))?.FirstOrDefault(e => e.Id == eventoId);
        if (antes is null) return ResultadoRegisto.Falha(404, "Evento não encontrado.");

        var resultado = await eventos.AtualizarAsync(dono.DonoId, jogoId, eventoId, pedido, ct);
        if (!resultado.Ok) return resultado;

        var depois = (await eventos.ListarAsync(dono.DonoId, jogoId, ct))?.FirstOrDefault(e => e.Id == eventoId) ?? antes;
        if (await estatisticas.JogoAsync(jogoId, ct) is { } jogo)
            await RegistarAsync(con, autor, "evento", "Evento corrigido",
                $"{DescricaoAlteracoes.Jogo(jogo, dono.DonoNome)} · {DescricaoAlteracoes.Correcao(antes, depois, jogo)}", jogoId, ct);
        return resultado;
    }

    /// <summary>Apaga um evento de qualquer jogo e guarda no registo o que ele era.</summary>
    public async Task<ResultadoAdmin> ApagarEventoAsync(Utilizador autor, int jogoId, long eventoId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        if (await DonoAsync(con, sql, jogoId, ct) is not { } dono) return ResultadoAdmin.Falha(404, "Jogo não encontrado.");
        var antes = (await eventos.ListarAsync(dono.DonoId, jogoId, ct))?.FirstOrDefault(e => e.Id == eventoId);
        if (antes is null || !await eventos.ApagarAsync(dono.DonoId, jogoId, eventoId, ct))
            return ResultadoAdmin.Falha(404, "Evento não encontrado.");

        if (await estatisticas.JogoAsync(jogoId, ct) is { } jogo)
            await RegistarAsync(con, autor, "evento", "Evento apagado",
                $"{DescricaoAlteracoes.Jogo(jogo, dono.DonoNome)} · {DescricaoAlteracoes.Evento(antes, jogo)}", jogoId, ct);
        return ResultadoAdmin.Sucesso();
    }

    // ------------------------------------------------------------------ registo

    /// <summary>As últimas alterações. tipo: «conta», «evento» ou vazio (todas). Null se o tipo não existir.</summary>
    public async Task<List<RegistoAlteracao>?> RegistoAsync(string? tipo, CancellationToken ct = default)
    {
        if (!string.IsNullOrEmpty(tipo) && tipo is not ("conta" or "evento")) return null;
        await using var con = await dados.OpenConnectionAsync(ct);
        return (await con.QueryAsync<RegistoAlteracao>(Cmd(sql["admin_registo"], new
        {
            tipo = string.IsNullOrEmpty(tipo) ? null : tipo, limite = LinhasDoRegisto
        }, ct))).ToList();
    }

    private async Task RegistarAsync(
        NpgsqlConnection con, Utilizador autor, string tipo, string acao, string detalhe, int? jogoId, CancellationToken ct)
    {
        try
        {
            await con.ExecuteAsync(Cmd(sql["admin_registar_alteracao"], new
            {
                autorId = (int?)autor.Id, autorNome = autor.Nome, tipo, acao, detalhe, jogoId
            }, ct));
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // A alteração já foi feita: um registo que falha não a desfaz, mas fica nos registos da API
            log.LogError(e, "Não foi possível registar a alteração «{Acao}» ({Detalhe}).", acao, detalhe);
        }
    }
}
