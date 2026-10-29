using System.Text.RegularExpressions;

namespace HandballScouting.Api;

/// <summary>Regras de validação do registo e da entrada (sem base de dados).</summary>
public static partial class ContaValidador
{
    public const int MinPalavraPasse = 8;
    public const int MaxPalavraPasse = 128;

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex PadraoEmail();

    [GeneratedRegex(@"^[0-9a-f]{64}\z")]
    private static partial Regex PadraoToken();

    /// <summary>O código do link do email: 32 bytes em hexadecimal (64 caracteres).</summary>
    public static bool TokenValido(string? token) => token is not null && PadraoToken().IsMatch(token);

    /// <summary>Email sem espaços e em minúsculas (é assim que fica guardado).</summary>
    public static string NormalizarEmail(string? email) => (email ?? "").Trim().ToLowerInvariant();

    public static List<string> ValidarRegisto(RegistoRequest r)
    {
        var erros = new List<string>();

        if (ErroNome(r.Nome) is { } erroNome) erros.Add(erroNome);

        var equipa = r.Equipa?.Trim() ?? "";
        if (equipa.Length == 0) erros.Add("o nome da equipa é obrigatório.");
        else if (equipa.Length > 80) erros.Add("o nome da equipa tem no máximo 80 caracteres.");

        if (ErroEmail(r.Email) is { } erroEmail) erros.Add(erroEmail);

        if (ErroPalavraPasse(r.PalavraPasse) is { } erroPalavraPasse) erros.Add(erroPalavraPasse);

        return erros;
    }

    /// <summary>O que está mal num nome de pessoa (uma frase em minúsculas); null se estiver bom.</summary>
    public static string? ErroNome(string? nome)
    {
        var n = nome?.Trim() ?? "";
        if (n.Length == 0) return "o nome é obrigatório.";
        return n.Length > 80 ? "o nome tem no máximo 80 caracteres." : null;
    }

    /// <summary>O que está mal num email (depois de o normalizar); null se estiver bom.</summary>
    public static string? ErroEmail(string? emailBruto)
    {
        var email = NormalizarEmail(emailBruto);
        if (email.Length == 0) return "o email é obrigatório.";
        return email.Length > 160 || !PadraoEmail().IsMatch(email) ? "o email não é válido." : null;
    }

    /// <summary>O que está mal numa palavra-passe nova (uma frase em minúsculas, sem maiúscula inicial); null se estiver boa.</summary>
    public static string? ErroPalavraPasse(string? palavraPasse)
    {
        var p = palavraPasse ?? "";
        if (p.Length < MinPalavraPasse) return $"a palavra-passe tem de ter pelo menos {MinPalavraPasse} caracteres.";
        if (p.Length > MaxPalavraPasse) return $"a palavra-passe tem no máximo {MaxPalavraPasse} caracteres.";
        if (string.IsNullOrWhiteSpace(p)) return "a palavra-passe não pode ser só espaços.";
        return null;
    }
}
