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

        var nome = r.Nome?.Trim() ?? "";
        if (nome.Length == 0) erros.Add("o nome é obrigatório.");
        else if (nome.Length > 80) erros.Add("o nome tem no máximo 80 caracteres.");

        var email = NormalizarEmail(r.Email);
        if (email.Length == 0) erros.Add("o email é obrigatório.");
        else if (email.Length > 160 || !PadraoEmail().IsMatch(email)) erros.Add("o email não é válido.");

        var palavraPasse = r.PalavraPasse ?? "";
        if (palavraPasse.Length < MinPalavraPasse) erros.Add($"a palavra-passe tem de ter pelo menos {MinPalavraPasse} caracteres.");
        else if (palavraPasse.Length > MaxPalavraPasse) erros.Add($"a palavra-passe tem no máximo {MaxPalavraPasse} caracteres.");
        else if (string.IsNullOrWhiteSpace(palavraPasse)) erros.Add("a palavra-passe não pode ser só espaços.");

        return erros;
    }
}
