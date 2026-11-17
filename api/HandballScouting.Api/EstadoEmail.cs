namespace HandballScouting.Api;

/// <summary>
/// Como está configurado o envio de emails, para a página de administração dizer se os emails chegam a alguém.
/// Nunca leva a senha nem o nome de utilizador do SMTP.
/// Modo: «nao_configurado» (sem Email__Host), «teste» (a caixa de correio de teste do docker-compose, que não entrega
/// nada) ou «real» (um servidor SMTP verdadeiro).
/// </summary>
public record EstadoEmail(string Modo, string? Host, int Porta, bool TemUtilizador, bool UsaSsl, string De, string UrlPublico, bool UrlPublicoLocal)
{
    public const string NaoConfigurado = "nao_configurado";
    public const string Teste = "teste";
    public const string Real = "real";

    private static readonly string[] AnfitrioesLocais = ["mailpit", "localhost", "127.0.0.1", "::1", "host.docker.internal"];

    /// <summary>O servidor é um destes anfitriões locais (a caixa de teste), que não entregam emails a ninguém.</summary>
    public static bool EhCaixaDeTeste(string? host) =>
        host is not null && AnfitrioesLocais.Contains(host.Trim().ToLowerInvariant());

    /// <summary>O endereço público é de localhost: as ligações dos emails só abrem neste computador.</summary>
    public static bool EhEnderecoLocal(string urlPublico) =>
        Uri.TryCreate(urlPublico, UriKind.Absolute, out var url) && AnfitrioesLocais.Contains(url.Host.ToLowerInvariant());

    public static EstadoEmail DasOpcoes(OpcoesEmail o) => new(
        Modo: !o.Configurado ? NaoConfigurado : EhCaixaDeTeste(o.Host) ? Teste : Real,
        Host: o.Host,
        Porta: o.Porta,
        TemUtilizador: !string.IsNullOrEmpty(o.Utilizador),
        UsaSsl: o.UsarSsl,
        De: o.De,
        UrlPublico: o.UrlPublico,
        UrlPublicoLocal: EhEnderecoLocal(o.UrlPublico));
}

/// <summary>O email que o botão «Enviar email de teste» da administração manda ao próprio admin.</summary>
public static class EmailTeste
{
    public const string Assunto = "Email de teste do Scouting de Andebol";

    private static string Linha(string nome) => string.Join(' ', nome.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    public static string Texto(string nome) =>
        $"""
        Olá {Linha(nome)},

        Este é um email de teste enviado pela administração do Scouting de Andebol. Se o estás a ler, o envio de emails está a funcionar:
        os emails de confirmação de conta e de recuperação da palavra-passe vão chegar às pessoas.
        """;

    public static string Html(string nome)
    {
        var nomeHtml = System.Net.WebUtility.HtmlEncode(Linha(nome));
        return $"""
        <!doctype html>
        <html lang="pt-PT">
        <body style="margin:0;padding:24px;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#14213d">
          <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
            <p style="margin:0 0 16px;font-size:18px;font-weight:bold">Scouting de Andebol</p>
            <p style="margin:0 0 12px">Olá {nomeHtml},</p>
            <p style="margin:0">Este é um email de teste enviado pela administração. Se o estás a ler, o envio de emails está a funcionar: os emails de confirmação de conta e de recuperação da palavra-passe vão chegar às pessoas.</p>
          </div>
        </body>
        </html>
        """;
    }
}
