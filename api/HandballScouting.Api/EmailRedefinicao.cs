using System.Net;
using System.Text.RegularExpressions;

namespace HandballScouting.Api;

/// <summary>O email com o link para escolher uma palavra-passe nova.</summary>
public static partial class EmailRedefinicao
{
    public const string Assunto = "Escolhe uma palavra-passe nova no Scouting de Andebol";

    [GeneratedRegex(@"\s+")]
    private static partial Regex Espacos();

    public static string LinkDe(string urlPublico, string token) =>
        $"{urlPublico.TrimEnd('/')}/redefinir.html?t={token}";

    /// <summary>O nome numa só linha (um nome com quebras de linha não pode estragar o email).</summary>
    private static string Linha(string nome) => Espacos().Replace(nome, " ").Trim();

    public static string Texto(string nome, string link) =>
        $"""
        Olá {Linha(nome)},

        Pediram para escolher uma palavra-passe nova para a tua conta no Scouting de Andebol. Abre esta ligação para a escolheres:

        {link}

        A ligação é válida durante 1 hora e só funciona uma vez. Se não foste tu, ignora este email: a tua palavra-passe não muda.
        """;

    public static string Html(string nome, string link)
    {
        var nomeHtml = WebUtility.HtmlEncode(Linha(nome));
        var linkHtml = WebUtility.HtmlEncode(link);
        return $"""
        <!doctype html>
        <html lang="pt-PT">
        <body style="margin:0;padding:24px;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#14213d">
          <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
            <p style="margin:0 0 16px;font-size:18px;font-weight:bold">Scouting de Andebol</p>
            <p style="margin:0 0 12px">Olá {nomeHtml},</p>
            <p style="margin:0 0 20px">Pediram para escolher uma palavra-passe nova para a tua conta.</p>
            <p style="margin:0 0 24px">
              <a href="{linkHtml}" style="display:inline-block;background:#1f4fd8;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">Escolher palavra-passe nova</a>
            </p>
            <p style="margin:0 0 8px;font-size:13px;color:#5b6577">Se o botão não funcionar, copia este endereço para o browser:</p>
            <p style="margin:0 0 20px;font-size:13px;word-break:break-all"><a href="{linkHtml}" style="color:#1f4fd8">{linkHtml}</a></p>
            <p style="margin:0;font-size:13px;color:#5b6577">A ligação é válida durante 1 hora e só funciona uma vez. Se não foste tu, ignora este email: a tua palavra-passe não muda.</p>
          </div>
        </body>
        </html>
        """;
    }
}
