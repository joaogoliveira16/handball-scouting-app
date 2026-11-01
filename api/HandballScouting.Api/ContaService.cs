using System.Security.Cryptography;
using Dapper;
using Npgsql;

namespace HandballScouting.Api;

/// <summary>
/// Resultado de registar, entrar, confirmar o email ou pedir outro email. Entrar traz a conta e o código da sessão
/// (que vai para o cookie); registar diz se o email de confirmação foi enviado; Codigo identifica falhas que a página trata.
/// </summary>
public record ResultadoConta(
    bool Ok, int Status, string? Erro, Utilizador? Utilizador = null, string? Token = null,
    string? Codigo = null, bool EmailEnviado = false)
{
    public static ResultadoConta Falha(int status, string erro, string? codigo = null) => new(false, status, erro, Codigo: codigo);
}

/// <summary>Contas e sessões. O cookie leva um código aleatório; na base de dados só fica o seu SHA-256.</summary>
public class ContaService(
    NpgsqlDataSource dados, SqlLoader sql, LimiteTentativas limite,
    LimiteEnvios envios, IEnviadorEmail enviador, OpcoesEmail opcoes, OpcoesAdmin admins, ILogger<ContaService> log)
{
    public static readonly TimeSpan DuracaoSessao = TimeSpan.FromDays(30);
    /// <summary>Durante quanto tempo o link do email de confirmação funciona.</summary>
    public static readonly TimeSpan ValidadeConfirmacao = TimeSpan.FromHours(24);
    /// <summary>Durante quanto tempo o link do email de recuperação da palavra-passe funciona.</summary>
    public static readonly TimeSpan ValidadeRedefinicao = TimeSpan.FromHours(1);
    /// <summary>Código das falhas em que a pessoa ainda tem de confirmar o email (a página oferece "reenviar").</summary>
    public const string CodigoPorConfirmar = "email_por_confirmar";
    /// <summary>Código da falha em que o link de recuperação não serve (a página oferece pedir outro).</summary>
    public const string CodigoLinkInvalido = "link_invalido";
    /// <summary>Código da falha em que um admin desativou a conta.</summary>
    public const string CodigoDesativada = "conta_desativada";
    private const string ViolacaoUnicidade = "23505";
    private const string MensagemEntrada = "Email ou palavra-passe errados.";
    private const string MensagemLinkInvalido = "A ligação é inválida ou já expirou. Pede um novo email de confirmação.";
    private const string MensagemRedefinicaoInvalida = "A ligação é inválida, já foi usada ou já expirou. Pede uma nova ligação para escolher a palavra-passe.";
    /// <summary>Prefixo do limite de pedidos de recuperação: cada endereço tem um limite à parte do dos emails de confirmação.</summary>
    private const string ChaveRedefinicao = "redefinir:";

    /// <summary>O que muda de um link por email para outro (confirmar a conta, escolher outra palavra-passe).</summary>
    private sealed record TipoDeLink(
        string SqlLimpar, string SqlCriar, TimeSpan Validade, Func<string, string, string> Link,
        string Assunto, Func<string, string, string> Texto, Func<string, string, string> Html, string Descricao);

    private static readonly TipoDeLink LinkConfirmacao = new(
        "limpar_verificacoes", "criar_verificacao", ValidadeConfirmacao, EmailConfirmacao.LinkDe,
        EmailConfirmacao.Assunto, EmailConfirmacao.Texto, EmailConfirmacao.Html, "de confirmação");

    private static readonly TipoDeLink LinkRedefinicao = new(
        "limpar_redefinicoes", "criar_redefinicao", ValidadeRedefinicao, EmailRedefinicao.LinkDe,
        EmailRedefinicao.Assunto, EmailRedefinicao.Texto, EmailRedefinicao.Html, "de recuperação da palavra-passe");

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
            id = await con.ExecuteScalarAsync<int>(Cmd(sql["registar_utilizador"], new { email, nome, hash, equipa = pedido.Equipa!.Trim() }, ct));
        }
        catch (PostgresException e) when (e.SqlState == ViolacaoUnicidade)
        {
            // Quem se registou e ainda não abriu o email pode pedir outro; uma conta já confirmada não se repete
            var porConfirmar = await con.QuerySingleOrDefaultAsync<Utilizador>(Cmd(sql["utilizador_por_confirmar"], new { email }, ct));
            return porConfirmar is null
                ? ResultadoConta.Falha(409, "Já existe uma conta com esse email.")
                : ResultadoConta.Falha(409, "Já existe uma conta com esse email, mas ainda não foi confirmada. Pede um novo email de confirmação.", CodigoPorConfirmar);
        }

        // A conta só entra depois de confirmar o email: não há sessão nem cookie aqui
        envios.RegistarPedido(email);
        var enviado = await EnviarConfirmacaoAsync(con, id, nome, email, ct);
        return new ResultadoConta(true, 201, null, new Utilizador { Id = id, Nome = nome, Email = email }, EmailEnviado: enviado);
    }

    private Task<bool> EnviarConfirmacaoAsync(NpgsqlConnection con, int utilizadorId, string nome, string email, CancellationToken ct) =>
        EnviarLinkAsync(con, LinkConfirmacao, utilizadorId, nome, email, ct);

    /// <summary>Cria um link novo e envia-o por email. Devolve false se o email não pôde seguir (a conta fica criada).</summary>
    private async Task<bool> EnviarLinkAsync(
        NpgsqlConnection con, TipoDeLink tipo, int utilizadorId, string nome, string email, CancellationToken ct)
    {
        if (!envios.PodeEnviar())
        {
            log.LogWarning("Limite geral de emails por hora atingido: a conta {UtilizadorId} não recebeu o email {Tipo}.", utilizadorId, tipo.Descricao);
            return false;
        }

        await con.ExecuteAsync(Cmd(sql[tipo.SqlLimpar], null, ct));   // aproveita para apagar os links que já expiraram
        var token = NovoToken();
        await con.ExecuteAsync(Cmd(sql[tipo.SqlCriar], new
        {
            tokenHash = PalavraPasse.HashDoToken(token), utilizadorId, expiraEm = DateTime.UtcNow + tipo.Validade
        }, ct));

        var link = tipo.Link(opcoes.UrlPublico, token);
        try
        {
            await enviador.EnviarAsync(email, tipo.Assunto, tipo.Texto(nome, link), tipo.Html(nome, link), ct);
            envios.RegistarEnvio();
            return true;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogError(e, "Não foi possível enviar o email {Tipo} à conta {UtilizadorId}.", tipo.Descricao, utilizadorId);
            return false;
        }
    }

    /// <summary>Confirma o email com o código do link. Não inicia sessão: a pessoa entra a seguir, com a palavra-passe.</summary>
    public async Task<ResultadoConta> ConfirmarEmailAsync(string? token, CancellationToken ct = default)
    {
        if (!ContaValidador.TokenValido(token)) return ResultadoConta.Falha(400, MensagemLinkInvalido);

        await using var con = await dados.OpenConnectionAsync(ct);
        var id = await con.ExecuteScalarAsync<int?>(Cmd(sql["confirmar_email"], new { tokenHash = PalavraPasse.HashDoToken(token!) }, ct));
        return id is null ? ResultadoConta.Falha(400, MensagemLinkInvalido) : new ResultadoConta(true, 204, null);
    }

    /// <summary>
    /// Envia outro link a uma conta por confirmar. Responde sempre da mesma maneira, exista a conta ou não
    /// (só o limite de pedidos por endereço e uma falha do servidor de email se distinguem).
    /// </summary>
    public async Task<ResultadoConta> ReenviarConfirmacaoAsync(string? emailBruto, CancellationToken ct = default)
    {
        var email = ContaValidador.NormalizarEmail(emailBruto);
        if (email.Length == 0 || email.Length > 160) return ResultadoConta.Falha(400, "Escreve o email da conta.");
        if (!envios.PodePedir(email))
            return ResultadoConta.Falha(429, "Já enviámos vários emails para este endereço. Espera uns minutos antes de pedir outro.");
        envios.RegistarPedido(email);

        await using var con = await dados.OpenConnectionAsync(ct);
        var porConfirmar = await con.QuerySingleOrDefaultAsync<Utilizador>(Cmd(sql["utilizador_por_confirmar"], new { email }, ct));
        if (porConfirmar is null) return new ResultadoConta(true, 204, null);

        return await EnviarConfirmacaoAsync(con, porConfirmar.Id, porConfirmar.Nome, porConfirmar.Email, ct)
            ? new ResultadoConta(true, 204, null)
            : ResultadoConta.Falha(503, "Não foi possível enviar o email agora. Tenta outra vez daqui a pouco.");
    }

    /// <summary>
    /// Envia o link para escolher outra palavra-passe. Responde sempre da mesma maneira, exista a conta ou não
    /// (só o limite de pedidos por endereço e uma falha do servidor de email se distinguem).
    /// </summary>
    public async Task<ResultadoConta> PedirRedefinicaoAsync(string? emailBruto, CancellationToken ct = default)
    {
        var email = ContaValidador.NormalizarEmail(emailBruto);
        if (email.Length == 0 || email.Length > 160) return ResultadoConta.Falha(400, "Escreve o email da conta.");
        if (!envios.PodePedir(ChaveRedefinicao + email))
            return ResultadoConta.Falha(429, "Já enviámos vários emails para este endereço. Espera uns minutos antes de pedir outro.");
        envios.RegistarPedido(ChaveRedefinicao + email);

        await using var con = await dados.OpenConnectionAsync(ct);
        var conta = await con.QuerySingleOrDefaultAsync<Utilizador>(Cmd(sql["utilizador_para_redefinir"], new { email }, ct));
        if (conta is null) return new ResultadoConta(true, 204, null);

        return await EnviarLinkAsync(con, LinkRedefinicao, conta.Id, conta.Nome, conta.Email, ct)
            ? new ResultadoConta(true, 204, null)
            : ResultadoConta.Falha(503, "Não foi possível enviar o email agora. Tenta outra vez daqui a pouco.");
    }

    /// <summary>
    /// Escolhe a palavra-passe nova com o código do link. Termina as sessões da conta e confirma o email (o link
    /// chegou à caixa de correio da pessoa). Não inicia sessão: a pessoa entra a seguir com a palavra-passe nova.
    /// </summary>
    public async Task<ResultadoConta> RedefinirPalavraPasseAsync(string? token, string? palavraPasse, CancellationToken ct = default)
    {
        if (!ContaValidador.TokenValido(token)) return ResultadoConta.Falha(400, MensagemRedefinicaoInvalida, CodigoLinkInvalido);
        if (ContaValidador.ErroPalavraPasse(palavraPasse) is { } erro)
            return ResultadoConta.Falha(400, char.ToUpperInvariant(erro[0]) + erro[1..]);

        var hash = PalavraPasse.Hash(palavraPasse!);
        await using var con = await dados.OpenConnectionAsync(ct);
        var conta = await con.QuerySingleOrDefaultAsync<Utilizador>(Cmd(sql["redefinir_palavra_passe"], new
        {
            tokenHash = PalavraPasse.HashDoToken(token!), hash
        }, ct));
        if (conta is null) return ResultadoConta.Falha(400, MensagemRedefinicaoInvalida, CodigoLinkInvalido);

        limite.Limpar(conta.Email);   // quem acabou de escolher a palavra-passe não fica bloqueado pelas tentativas de antes
        return new ResultadoConta(true, 204, null);
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

        // Palavra-passe certa, mas um admin desativou a conta: sem sessão (e sem dizer isto a quem só adivinha)
        if (conta.Desativado)
            return ResultadoConta.Falha(403, "Esta conta foi desativada. Fala com quem administra a app.", CodigoDesativada);

        // Palavra-passe certa, mas o email ainda não foi confirmado: sem sessão (e sem dizer isto a quem só adivinha)
        if (!conta.EmailVerificado)
            return ResultadoConta.Falha(403, "Confirma o teu email para entrar. Enviámos-te uma ligação quando criaste a conta.", CodigoPorConfirmar);

        limite.Limpar(email);
        // Um email da lista de admins da configuração (Administracao__Emails) passa a admin ao entrar
        if (!conta.Admin && admins.Contem(email))
        {
            await PromoverConfiguradosAsync(con, [email], ct);
            conta.Admin = true;
        }
        var token = await CriarSessaoAsync(con, conta.Id, ct);
        return new ResultadoConta(true, 200, null, new Utilizador { Id = conta.Id, Nome = conta.Nome, Email = conta.Email, Admin = conta.Admin }, token);
    }

    /// <summary>
    /// Ao arrancar a API: as contas confirmadas cujo email está em Administracao__Emails passam a admin
    /// (assim uma sessão que já estava aberta também fica com o papel).
    /// </summary>
    public async Task PromoverAdminsConfiguradosAsync(CancellationToken ct = default)
    {
        if (admins.Emails.Count == 0) return;
        await using var con = await dados.OpenConnectionAsync(ct);
        await PromoverConfiguradosAsync(con, admins.Emails.ToArray(), ct);
    }

    private async Task PromoverConfiguradosAsync(NpgsqlConnection con, string[] emails, CancellationToken ct)
    {
        var promovidos = await con.QueryAsync<string>(Cmd(sql["admin_promover_emails"], new { emails }, ct));
        foreach (var email in promovidos)
        {
            log.LogInformation("A conta {Email} passou a admin (configuração Administracao__Emails).", email);
            await con.ExecuteAsync(Cmd(sql["admin_registar_alteracao"], new
            {
                autorId = (int?)null, autorNome = "Sistema", tipo = "conta", acao = "Papel alterado",
                detalhe = $"{email}: Normal passou a Admin (configuração)", jogoId = (int?)null
            }, ct));
        }
    }

    /// <summary>
    /// Envia à conta o link para escolher outra palavra-passe, a pedido de um admin (que nunca vê a palavra-passe).
    /// Null se a conta não existe ou está desativada; false se o email não pôde seguir.
    /// </summary>
    public async Task<bool?> EnviarRedefinicaoAsync(int utilizadorId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        var conta = await con.QuerySingleOrDefaultAsync<Utilizador>(Cmd(sql["utilizador_por_id"], new { id = utilizadorId }, ct));
        if (conta is null) return null;
        return await EnviarLinkAsync(con, LinkRedefinicao, conta.Id, conta.Nome, conta.Email, ct);
    }

    /// <summary>
    /// Envia à conta o link para confirmar o email, a pedido de um admin que acabou de mudar o email dela.
    /// Null se a conta não existe; false se o email não pôde seguir.
    /// </summary>
    public async Task<bool?> EnviarConfirmacaoDaContaAsync(int utilizadorId, CancellationToken ct = default)
    {
        await using var con = await dados.OpenConnectionAsync(ct);
        var conta = await con.QuerySingleOrDefaultAsync<Utilizador>(Cmd(sql["utilizador_por_id"], new { id = utilizadorId }, ct));
        if (conta is null) return null;
        return await EnviarConfirmacaoAsync(con, conta.Id, conta.Nome, conta.Email, ct);
    }

    private async Task<string> CriarSessaoAsync(NpgsqlConnection con, int utilizadorId, CancellationToken ct)
    {
        await con.ExecuteAsync(Cmd(sql["limpar_sessoes"], null, ct));   // aproveita para apagar as sessões que já expiraram
        var token = NovoToken();
        await con.ExecuteAsync(Cmd(sql["criar_sessao"], new
        {
            tokenHash = PalavraPasse.HashDoToken(token), utilizadorId, expiraEm = DateTime.UtcNow + DuracaoSessao
        }, ct));
        return token;
    }

    /// <summary>32 bytes aleatórios em hexadecimal (64 caracteres): serve de código da sessão e do link do email.</summary>
    private static string NovoToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();

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
