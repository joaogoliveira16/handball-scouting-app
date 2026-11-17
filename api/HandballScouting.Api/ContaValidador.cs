using System.Text;
using System.Text.RegularExpressions;

namespace HandballScouting.Api;

/// <summary>Regras de validação do registo e da entrada (sem base de dados).</summary>
public static partial class ContaValidador
{
    public const int MinPalavraPasse = 8;
    public const int MaxPalavraPasse = 128;

    /// <summary>
    /// As palavras-passe mais usadas que ainda cumpririam o resto das regras (8 ou mais caracteres, com letra e número):
    /// são as primeiras que qualquer pessoa ou programa experimenta. Compara-se sem olhar a maiúsculas.
    /// </summary>
    private static readonly HashSet<string> PalavrasPasseComuns = new(StringComparer.OrdinalIgnoreCase)
    {
        "password1", "password12", "password123", "password1234", "password12345", "passw0rd", "p@ssw0rd", "p@ssword1",
        "qwerty123", "qwerty1234", "qwerty12345", "qwertyuiop1", "abc12345", "abcd1234", "abcd12345", "abc123456", "abcde12345",
        "a1b2c3d4", "q1w2e3r4", "1q2w3e4r", "1qaz2wsx", "1q2w3e4r5t", "zaq12wsx", "asdf1234", "asdfghjkl1", "zxcvbnm123",
        "iloveyou1", "iloveyou12", "iloveyou123", "welcome1", "welcome123", "letmein123", "monkey123", "dragon123", "master123",
        "admin123", "admin1234", "admin12345", "administrador1", "administrador123", "teste1234", "test1234", "teste12345",
        "senha123", "senha1234", "senha12345", "palavrapasse1", "palavrapasse123", "palavra123", "passe1234", "passe12345",
        "portugal1", "portugal123", "benfica1", "benfica123", "sporting1", "sporting123", "fcporto123", "porto1234",
        "football1", "football123", "handball1", "handball123", "andebol1", "andebol123", "scouting1", "scouting123",
        "playbyplay1", "playbyplay123", "aaaaaaa1", "aaaa1111", "11111111a", "12345678a", "123456789a", "1234567890a",
    };

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
        if (!p.EnumerateRunes().Any(Rune.IsLetter) || !p.EnumerateRunes().Any(Rune.IsDigit))
            return "a palavra-passe tem de ter pelo menos uma letra e um número.";
        if (PalavrasPasseComuns.Contains(p)) return "essa palavra-passe é demasiado comum, escolhe outra.";
        return null;
    }
}
