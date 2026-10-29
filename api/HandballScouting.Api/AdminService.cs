using Dapper;
using Npgsql;

namespace HandballScouting.Api;

/// <summary>
/// A área de administração: ver todas as contas e jogos, editar, desativar e eliminar contas, mudar o papel, pedir a
/// recuperação da palavra-passe, terminar, reabrir e apagar jogos e corrigir ou apagar eventos de qualquer jogo, e tirar
/// cópias de segurança (JSON) de uma conta ou de um jogo. Cada alteração deixa uma linha no registo de alterações.
/// A autorização (só admins) é das rotas /api/admin (ver <see cref="Autenticacao.ExigirAdmin"/>); aqui tratam-se as regras.
/// </summary>
public class AdminService(
    NpgsqlDataSource dados, SqlLoader sql, ContaService contas, CadastroService cadastro, EventosService eventos,
    EstatisticasService estatisticas, OpcoesEmail opcoesEmail, IEnviadorEmail enviador, LimiteEnvios envios, ILogger<AdminService> log)
{
    private const string ViolacaoUnicidade = "23505";

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

    /// <summary>
    /// Muda o nome e o email de uma conta. Uma conta de admin não se edita (tira-se-lhe primeiro o papel) nem a própria.
    /// Se o email muda, a conta volta a ficar por confirmar, perde as sessões e os links antigos, e o email novo recebe
    /// o link para confirmar: sem isso, quem escreveu o email errado ficava com uma conta a que ninguém acede.
    /// </summary>
    public async Task<ResultadoEdicaoConta> EditarContaAsync(Utilizador autor, int id, EditarContaRequest pedido, CancellationToken ct = default)
    {
        if (id == autor.Id) return ResultadoEdicaoConta.Falha(400, "Não podes editar a tua própria conta aqui.");
        var erros = new[] { ContaValidador.ErroNome(pedido.Nome), ContaValidador.ErroEmail(pedido.Email) }.OfType<string>().ToList();
        if (erros.Count > 0) return ResultadoEdicaoConta.Falha(400, string.Join(" ", erros.Select(Maiuscula)));

        var nome = pedido.Nome!.Trim();
        var email = ContaValidador.NormalizarEmail(pedido.Email);

        await using var con = await dados.OpenConnectionAsync(ct);
        if (await UtilizadorAsync(con, sql, id, ct) is not { } alvo) return ResultadoEdicaoConta.Falha(404, "Conta não encontrada.");
        if (alvo.Papel == Papeis.Admin) return ResultadoEdicaoConta.Falha(409, "Uma conta de admin não se edita: tira-lhe primeiro o papel de admin.");
        if (nome == alvo.Nome && email == alvo.Email) return ResultadoEdicaoConta.Falha(400, "Não mudaste nada.");

        ContaEditada? editada;
        try
        {
            editada = await con.QuerySingleOrDefaultAsync<ContaEditada>(Cmd(sql["admin_editar_conta"], new { id, nome, email }, ct));
        }
        catch (PostgresException e) when (e.SqlState == ViolacaoUnicidade)
        {
            return ResultadoEdicaoConta.Falha(409, "Já existe uma conta com este email.");
        }
        if (editada is null) return ResultadoEdicaoConta.Falha(409, "A conta mudou entretanto: atualiza a lista e tenta outra vez.");

        await RegistarAsync(con, autor, "conta", "Conta editada", DescricaoAlteracoes.ContaEditada(alvo, nome, email), null, ct);
        if (!editada.EmailMudou) return new ResultadoEdicaoConta(true, 200, null);

        var enviado = await contas.EnviarConfirmacaoDaContaAsync(id, ct) == true;
        return new ResultadoEdicaoConta(true, 200, null, EmailMudou: true, EmailEnviado: enviado);
    }

    /// <summary>«o email não é válido.» -> «O email não é válido.»</summary>
    private static string Maiuscula(string frase) => frase.Length == 0 ? frase : char.ToUpperInvariant(frase[0]) + frase[1..];

    /// <summary>
    /// Elimina uma conta e tudo o que é dela (equipas, jogadores, jogos com os eventos). Não se desfaz, por isso quem
    /// elimina tem de escrever o email da conta. Ninguém elimina a própria conta, e uma conta de admin perde primeiro o papel.
    /// </summary>
    public async Task<ResultadoAdmin> EliminarContaAsync(Utilizador autor, int id, string? email, CancellationToken ct = default)
    {
        if (id == autor.Id) return ResultadoAdmin.Falha(400, "Não podes eliminar a tua própria conta.");

        await using var con = await dados.OpenConnectionAsync(ct);
        if (await UtilizadorAsync(con, sql, id, ct) is not { } alvo) return ResultadoAdmin.Falha(404, "Conta não encontrada.");
        if (alvo.Papel == Papeis.Admin) return ResultadoAdmin.Falha(409, "Uma conta de admin não se elimina: tira-lhe primeiro o papel de admin.");
        if (ContaValidador.NormalizarEmail(email) != ContaValidador.NormalizarEmail(alvo.Email))
            return ResultadoAdmin.Falha(400, "Escreve o email da conta para confirmar que a queres eliminar.");

        var saiu = await con.QuerySingleOrDefaultAsync<ContaEliminada>(Cmd(sql["admin_eliminar_conta"], new { id }, ct));
        if (saiu is null) return ResultadoAdmin.Falha(409, "A conta mudou entretanto: atualiza a lista e tenta outra vez.");

        await RegistarAsync(con, autor, "conta", "Conta eliminada", DescricaoAlteracoes.ContaEliminada(alvo, saiu), null, ct);
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

    // ------------------------------------------------------------------ emails

    /// <summary>Como está configurado o envio de emails (sem segredos).</summary>
    public EstadoEmail EstadoDoEmail() => EstadoEmail.DasOpcoes(opcoesEmail);

    /// <summary>Manda um email de teste ao próprio admin, para ele ver se o envio funciona.</summary>
    public async Task<ResultadoAdmin> TestarEmailAsync(Utilizador autor, CancellationToken ct = default)
    {
        if (!opcoesEmail.Configurado) return ResultadoAdmin.Falha(409, "O envio de emails não está configurado (falta EMAIL_HOST no .env).");
        if (!envios.PodePedir(autor.Email) || !envios.PodeEnviar())
            return ResultadoAdmin.Falha(429, "Já pediste emails de teste a mais: tenta outra vez daqui a pouco.");

        envios.RegistarPedido(autor.Email);
        try
        {
            await enviador.EnviarAsync(autor.Email, EmailTeste.Assunto, EmailTeste.Texto(autor.Nome), EmailTeste.Html(autor.Nome), ct);
            envios.RegistarEnvio();
            return ResultadoAdmin.Sucesso();
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogWarning(e, "O email de teste para {Email} falhou.", autor.Email);
            return ResultadoAdmin.Falha(503, $"Não foi possível enviar o email: {Resumo(e)}");
        }
    }

    /// <summary>A mensagem do erro numa só linha e curta (um erro de SMTP diz muitas vezes o que está mal: «Authentication failed»).</summary>
    public static string Resumo(Exception e)
    {
        var texto = string.Join(' ', e.GetBaseException().Message.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return texto.Length > 200 ? texto[..200] + "…" : texto;
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

    /// <summary>Terminar ou reabrir o jogo de outra conta (as mesmas regras do dono). O registo guarda quem o fez.</summary>
    public async Task<ResultadoAdmin> DefinirTerminadoAsync(Utilizador autor, int jogoId, bool? terminado, CancellationToken ct = default)
    {
        if (terminado is null) return ResultadoAdmin.Falha(400, "Diz se o jogo fica terminado ou reaberto.");

        await using var con = await dados.OpenConnectionAsync(ct);
        if (await DonoAsync(con, sql, jogoId, ct) is not { } dono || await estatisticas.JogoAsync(jogoId, ct) is not { } jogo)
            return ResultadoAdmin.Falha(404, "Jogo não encontrado.");
        if ((jogo.TerminadoEm is not null) == terminado.Value)
            return ResultadoAdmin.Falha(409, terminado.Value ? "O jogo já estava terminado." : "O jogo já estava a decorrer.");

        var r = await cadastro.TerminarJogoAsync(dono.DonoId, jogoId, new TerminarJogoRequest(terminado), ct);
        if (!r.Ok) return ResultadoAdmin.Falha(r.Status, r.Erro ?? "Não foi possível mudar o jogo.");

        await RegistarAsync(con, autor, "jogo", terminado.Value ? "Jogo terminado" : "Jogo reaberto",
            DescricaoAlteracoes.Jogo(jogo, dono.DonoNome), jogoId, ct);
        return ResultadoAdmin.Sucesso();
    }

    /// <summary>
    /// Apaga o jogo de outra conta com os eventos, a convocatória e o relógio. O registo guarda que jogo era e
    /// quantos eventos tinha (a página de administração tira antes uma cópia de segurança).
    /// </summary>
    public async Task<ResultadoAdmin> ApagarJogoAsync(Utilizador autor, int jogoId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        if (await DonoAsync(con, sql, jogoId, ct) is not { } dono || await estatisticas.JogoAsync(jogoId, ct) is not { } jogo)
            return ResultadoAdmin.Falha(404, "Jogo não encontrado.");

        var nEventos = (await eventos.ListarAsync(dono.DonoId, jogoId, ct))?.Count ?? 0;
        var r = await cadastro.ApagarJogoAsync(dono.DonoId, jogoId, ct);
        if (!r.Ok) return ResultadoAdmin.Falha(r.Status, r.Erro ?? "Não foi possível apagar o jogo.");

        // Sem jogo_id: o jogo já não existe, por isso a linha não leva a lado nenhum
        await RegistarAsync(con, autor, "jogo", "Jogo apagado", DescricaoAlteracoes.JogoApagado(jogo, dono.DonoNome, nEventos), null, ct);
        return ResultadoAdmin.Sucesso();
    }

    // ------------------------------------------------------------------ cópias de segurança

    /// <summary>
    /// Tudo o que é de uma conta num JSON (conta sem palavra-passe, equipas, escudos, jogadores, jogos com convocatória,
    /// relógio e eventos). Null se a conta não existe.
    /// </summary>
    public async Task<Exportacao?> ExportarContaAsync(int id, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        if (await UtilizadorAsync(con, sql, id, ct) is not { } conta) return null;
        var json = await con.QuerySingleOrDefaultAsync<string>(Cmd(sql["admin_exportar_conta"], new { id }, ct));
        return json is null ? null : new Exportacao(json, NomesDeExportacao.Conta(id, conta.Email, DateTimeOffset.UtcNow));
    }

    /// <summary>Um jogo num JSON (jogo, equipas, jogadores, convocatória, relógio e eventos). Null se o jogo não existe.</summary>
    public async Task<Exportacao?> ExportarJogoAsync(int id, CancellationToken ct = default)
    {
        if (await estatisticas.JogoAsync(id, ct) is not { } jogo) return null;
        await using var con = await dados.OpenConnectionAsync(ct);
        var json = await con.QuerySingleOrDefaultAsync<string>(Cmd(sql["admin_exportar_jogo"], new { id }, ct));
        return json is null ? null : new Exportacao(json, NomesDeExportacao.Jogo(id, jogo.CasaNome, jogo.ForaNome, DateTimeOffset.UtcNow));
    }

    // ------------------------------------------------------------------ registo

    /// <summary>As últimas alterações. tipo: «conta», «evento», «jogo» ou vazio (todas). Null se o tipo não existir.</summary>
    public async Task<List<RegistoAlteracao>?> RegistoAsync(string? tipo, CancellationToken ct = default)
    {
        if (!string.IsNullOrEmpty(tipo) && tipo is not ("conta" or "evento" or "jogo")) return null;
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
