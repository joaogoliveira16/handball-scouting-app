using System.Security.Cryptography;

namespace HandballScouting.Api;

/// <summary>
/// Hash das palavras-passe com PBKDF2 (HMAC-SHA-256, sal aleatório). A palavra-passe nunca é guardada:
/// só o texto "pbkdf2-sha256$iterações$sal$hash" (base64).
/// </summary>
public static class PalavraPasse
{
    private const string Prefixo = "pbkdf2-sha256";
    private const int Iteracoes = 600_000;   // recomendação da OWASP para PBKDF2-HMAC-SHA256
    private const int BytesSal = 16;
    private const int BytesHash = 32;

    public static string Hash(string palavraPasse)
    {
        var sal = RandomNumberGenerator.GetBytes(BytesSal);
        var hash = Rfc2898DeriveBytes.Pbkdf2(palavraPasse, sal, Iteracoes, HashAlgorithmName.SHA256, BytesHash);
        return $"{Prefixo}${Iteracoes}${Convert.ToBase64String(sal)}${Convert.ToBase64String(hash)}";
    }

    /// <summary>true se a palavra-passe corresponde ao hash (comparação em tempo constante). Hash estragado = false.</summary>
    public static bool Verificar(string palavraPasse, string guardado)
    {
        var partes = guardado.Split('$');
        if (partes.Length != 4 || partes[0] != Prefixo || !int.TryParse(partes[1], out var iteracoes) || iteracoes < 1)
            return false;
        try
        {
            var sal = Convert.FromBase64String(partes[2]);
            var esperado = Convert.FromBase64String(partes[3]);
            if (esperado.Length == 0) return false;
            var calculado = Rfc2898DeriveBytes.Pbkdf2(palavraPasse, sal, iteracoes, HashAlgorithmName.SHA256, esperado.Length);
            return CryptographicOperations.FixedTimeEquals(calculado, esperado);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    /// <summary>SHA-256 do código da sessão, em hexadecimal minúsculo (64 caracteres): é o que fica na base de dados.</summary>
    public static string HashDoToken(string token) =>
        Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    // Um hash qualquer, usado para gastar o mesmo tempo quando o email não existe (não revela quais emails têm conta)
    private static readonly Lazy<string> HashFalso = new(() => Hash("palavra-passe-que-ninguem-usa"));

    public static void GastarTempo(string palavraPasse) => Verificar(palavraPasse, HashFalso.Value);
}
