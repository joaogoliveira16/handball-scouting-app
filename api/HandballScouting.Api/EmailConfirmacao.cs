using System.Net;
using System.Text.RegularExpressions;

namespace HandballScouting.Api;

/// <summary>O email com o link para confirmar a conta.</summary>
public static partial class EmailConfirmacao
{
    public const string Assunto = "Confirma o teu email no Scouting de Andebol";

    [GeneratedRegex(@"\s+")]
    private static partial Regex Espacos();

    public static string LinkDe(string urlPublico, string token) =>
        $"{urlPublico.TrimEnd('/')}/verificar.html?t={token}";

    /// <summary>O nome numa só linha (um nome com quebras de linha não pode estragar o email).</summary>
    private static string Linha(string nome) => Espacos().Replace(nome, " ").Trim();

    public static string Texto(string nome, string link) =>
        $"""
        Olá {Linha(nome)},

        Para ativares a tua conta no Scouting de Andebol, confirma o teu email neste link:

        {link}

        O link é válido durante 24 horas. Se não criaste esta conta, ignora este email.
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
            <p style="margin:0 0 20px">Para ativares a tua conta, confirma o teu email:</p>
            <p style="margin:0 0 24px">
              <a href="{linkHtml}" style="display:inline-block;background:#1f4fd8;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">Confirmar email</a>
            </p>
            <p style="margin:0 0 8px;font-size:13px;color:#5b6577">Se o botão não funcionar, copia este endereço para o browser:</p>
            <p style="margin:0 0 20px;font-size:13px;word-break:break-all"><a href="{linkHtml}" style="color:#1f4fd8">{linkHtml}</a></p>
            <p style="margin:0;font-size:13px;color:#5b6577">O link é válido durante 24 horas. Se não criaste esta conta, ignora este email.</p>
          </div>
        </body>
        </html>
        """;
    }
}
