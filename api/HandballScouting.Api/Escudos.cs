namespace HandballScouting.Api;

/// <summary>Regras do escudo (símbolo) de uma equipa: tamanho máximo e tipos de imagem aceites.</summary>
public static class Escudos
{
    /// <summary>Tamanho máximo da imagem guardada. O browser reduz o escudo antes de o enviar, por isso chega a poucos KB.</summary>
    public const int MaxBytes = 200 * 1024;

    public const string Png = "image/png";
    public const string Jpeg = "image/jpeg";
    public const string Webp = "image/webp";

    /// <summary>
    /// Descobre o tipo da imagem pelos primeiros bytes (e não pelo que o cliente diz): PNG, JPEG ou WebP.
    /// Devolve null para qualquer outra coisa (por exemplo SVG, que pode trazer scripts).
    /// </summary>
    public static string? DetetarTipo(ReadOnlySpan<byte> dados)
    {
        if (dados.Length >= 8 && dados[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }))
            return Png;
        if (dados.Length >= 3 && dados[0] == 0xFF && dados[1] == 0xD8 && dados[2] == 0xFF)
            return Jpeg;
        // WebP: "RIFF" + 4 bytes de tamanho + "WEBP"
        if (dados.Length >= 12 && dados[..4].SequenceEqual("RIFF"u8) && dados.Slice(8, 4).SequenceEqual("WEBP"u8))
            return Webp;
        return null;
    }

    /// <summary>
    /// Valida a imagem enviada. Devolve o tipo (e nenhum erro) ou o erro a mostrar com o estado HTTP
    /// (400 imagem em falta ou de outro tipo, 413 demasiado grande).
    /// </summary>
    public static (string? Tipo, string? Erro, int Status) Validar(ReadOnlySpan<byte> dados)
    {
        if (dados.Length == 0)
            return (null, "Falta a imagem do escudo.", 400);
        if (dados.Length > MaxBytes)
            return (null, $"O escudo tem de ter no máximo {MaxBytes / 1024} KB.", 413);
        var tipo = DetetarTipo(dados);
        return tipo is null
            ? (null, "O escudo tem de ser uma imagem PNG, JPEG ou WebP.", 400)
            : (tipo, null, 200);
    }
}

/// <summary>A imagem de um escudo tal como está na base de dados.</summary>
public class EscudoImagem
{
    public string Tipo { get; set; } = "";
    public byte[] Dados { get; set; } = Array.Empty<byte>();
    public long Versao { get; set; }
}
