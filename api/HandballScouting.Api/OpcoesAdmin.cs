using Microsoft.Extensions.Configuration;

namespace HandballScouting.Api;

/// <summary>
/// Quem administra a app por configuração: os emails em Administracao__Emails (separados por vírgula, ponto e vírgula
/// ou espaço) são admins assim que a conta existe e tem o email confirmado. É assim que nasce o primeiro admin: o
/// registo público nunca dá o papel a ninguém. Os outros admins escolhem-se na página de administração.
/// </summary>
public class OpcoesAdmin
{
    private static readonly char[] Separadores = [',', ';', ' ', '\n', '\r', '\t'];

    public IReadOnlyList<string> Emails { get; init; } = [];

    public bool Contem(string? email) =>
        Emails.Contains(ContaValidador.NormalizarEmail(email));

    /// <summary>Lê a lista à mão: um valor vazio (variável do docker-compose sem valor) conta como «sem admins por configuração».</summary>
    public static OpcoesAdmin Ler(IConfiguration configuracao) => De(configuracao["Administracao:Emails"]);

    public static OpcoesAdmin De(string? texto) => new()
    {
        Emails = (texto ?? "")
            .Split(Separadores, StringSplitOptions.RemoveEmptyEntries)
            .Select(ContaValidador.NormalizarEmail)
            .Where(e => e.Length > 0)
            .Distinct()
            .ToList()
    };
}
