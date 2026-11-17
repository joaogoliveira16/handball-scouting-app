using System.Globalization;
using System.Text;

namespace HandballScouting.Api;

/// <summary>Uma cópia de segurança em JSON e o nome com que o browser a guarda.</summary>
public record Exportacao(string Json, string Ficheiro);

/// <summary>Os nomes dos ficheiros das cópias de segurança: só letras minúsculas, números e hífenes, e a data no fim.</summary>
public static class NomesDeExportacao
{
    /// <summary>«conta-4-ana-exemplo-pt-20261029-1830.json».</summary>
    public static string Conta(int id, string? email, DateTimeOffset quando) =>
        $"conta-{id}-{Etiqueta(email)}-{Carimbo(quando)}.json";

    /// <summary>«jogo-12-leoes-vs-falcoes-20261029-1830.json».</summary>
    public static string Jogo(int id, string? casa, string? fora, DateTimeOffset quando) =>
        $"jogo-{id}-{Etiqueta(casa)}-vs-{Etiqueta(fora)}-{Carimbo(quando)}.json";

    /// <summary>A data e a hora em UTC, por ordem, para os ficheiros ficarem ordenados pelo nome.</summary>
    public static string Carimbo(DateTimeOffset quando) => quando.UtcDateTime.ToString("yyyyMMdd-HHmm", CultureInfo.InvariantCulture);

    /// <summary>
    /// O texto como pode aparecer num nome de ficheiro: sem acentos, em minúsculas, tudo o que não é letra ou número
    /// vira um hífen (sem repetidos nem nas pontas) e no máximo «maximo» caracteres. Sem nada de aproveitável: «sem-nome».
    /// </summary>
    public static string Etiqueta(string? texto, int maximo = 30)
    {
        var sb = new StringBuilder();
        foreach (var c in (texto ?? "").Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
            var minuscula = char.ToLowerInvariant(c);
            if (minuscula is (>= 'a' and <= 'z') or (>= '0' and <= '9')) sb.Append(minuscula);
            else if (sb.Length > 0 && sb[^1] != '-') sb.Append('-');
        }
        var etiqueta = sb.ToString().Trim('-');
        if (etiqueta.Length > maximo) etiqueta = etiqueta[..maximo].TrimEnd('-');
        return etiqueta.Length == 0 ? "sem-nome" : etiqueta;
    }
}
