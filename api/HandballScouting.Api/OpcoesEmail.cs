using Microsoft.Extensions.Configuration;

namespace HandballScouting.Api;

/// <summary>
/// Como enviar emails e onde a app está na web (para os links dos emails).
/// Variáveis de ambiente: Email__Host, Email__Porta, Email__Utilizador, Email__Senha, Email__UsarSsl,
/// Email__De, Email__NomeDe e App__UrlPublico.
/// </summary>
public class OpcoesEmail
{
    public string? Host { get; set; }
    public int Porta { get; set; } = 587;
    public string? Utilizador { get; set; }
    public string? Senha { get; set; }
    /// <summary>true = liga em STARTTLS (porta 587, a mais comum). A porta 465 (TLS direto) não é suportada.</summary>
    public bool UsarSsl { get; set; }
    public string De { get; set; } = "scouting@localhost";
    public string NomeDe { get; set; } = "Scouting de Andebol";
    /// <summary>Endereço da app visto por quem recebe o email, sem barra no fim (ex.: https://scouting.exemplo.pt).</summary>
    public string UrlPublico { get; set; } = "http://localhost:8080";

    public bool Configurado => !string.IsNullOrWhiteSpace(Host);

    /// <summary>Lê a configuração à mão: valores vazios (variáveis do docker-compose sem valor) contam como "não definido".</summary>
    public static OpcoesEmail Ler(IConfiguration configuracao)
    {
        string? Texto(string chave) => string.IsNullOrWhiteSpace(configuracao[chave]) ? null : configuracao[chave]!.Trim();

        return new OpcoesEmail
        {
            Host = Texto("Email:Host"),
            Porta = int.TryParse(Texto("Email:Porta"), out var porta) && porta is > 0 and < 65536 ? porta : 587,
            Utilizador = Texto("Email:Utilizador"),
            Senha = string.IsNullOrEmpty(configuracao["Email:Senha"]) ? null : configuracao["Email:Senha"],
            UsarSsl = bool.TryParse(Texto("Email:UsarSsl"), out var ssl) && ssl,
            De = Texto("Email:De") ?? "scouting@localhost",
            NomeDe = Texto("Email:NomeDe") ?? "Scouting de Andebol",
            UrlPublico = (Texto("App:UrlPublico") ?? "http://localhost:8080").TrimEnd('/'),
        };
    }
}
