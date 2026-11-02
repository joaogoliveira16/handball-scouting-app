namespace HandballScouting.Api;

/// <summary>Cookie de sessão, conta atual do pedido e filtros que protegem as rotas.</summary>
public static class Autenticacao
{
    public const string CookieSessao = "sessao";
    private const string ChaveConta = "conta-atual";

    public static string? LerToken(HttpRequest pedido) =>
        pedido.Cookies.TryGetValue(CookieSessao, out var token) ? token : null;

    public static void DefinirCookie(HttpContext http, string token)
    {
        http.Response.Cookies.Append(CookieSessao, token, new CookieOptions
        {
            HttpOnly = true,                  // o JavaScript da página não consegue ler o cookie
            SameSite = SameSiteMode.Lax,      // não segue em pedidos POST vindos de outros sites
            Secure = EHttps(http.Request),    // por trás de HTTPS (proxy) o cookie só viaja cifrado
            Path = "/",
            MaxAge = ContaService.DuracaoSessao
        });
    }

    public static void ApagarCookie(HttpContext http) =>
        http.Response.Cookies.Delete(CookieSessao, new CookieOptions { Path = "/", SameSite = SameSiteMode.Lax, Secure = EHttps(http.Request) });

    private static bool EHttps(HttpRequest pedido) =>
        pedido.IsHttps || string.Equals(pedido.Headers["X-Forwarded-Proto"].ToString(), "https", StringComparison.OrdinalIgnoreCase);

    /// <summary>A conta do pedido (null sem sessão válida). Guarda o resultado para o resto do pedido.</summary>
    public static async Task<Utilizador?> ObterContaAsync(HttpContext http, CancellationToken ct = default)
    {
        if (http.Items.TryGetValue(ChaveConta, out var guardada)) return guardada as Utilizador;
        var contas = http.RequestServices.GetRequiredService<ContaService>();
        var conta = await contas.DaSessaoAsync(LerToken(http.Request), ct);
        http.Items[ChaveConta] = conta;
        return conta;
    }

    /// <summary>A conta de um pedido que passou por <see cref="ExigirConta"/>.</summary>
    public static Utilizador ContaAtual(this HttpContext http) =>
        http.Items[ChaveConta] as Utilizador ?? throw new InvalidOperationException("Rota sem ExigirConta.");

    /// <summary>Só deixa passar quem tem sessão iniciada (401 caso contrário).</summary>
    public static TBuilder ExigirConta<TBuilder>(this TBuilder construtor) where TBuilder : IEndpointConventionBuilder =>
        construtor.AddEndpointFilter(async (contexto, seguinte) =>
        {
            var conta = await ObterContaAsync(contexto.HttpContext, contexto.HttpContext.RequestAborted);
            if (conta is null)
                return Results.Json(new { erro = "Inicia sessão para continuar." }, statusCode: StatusCodes.Status401Unauthorized);
            return await seguinte(contexto);
        });

    /// <summary>
    /// Só deixa passar admins: sem sessão 401, com sessão de uma conta normal 403. As respostas da administração nunca
    /// ficam em cache (têm dados de todas as contas).
    /// </summary>
    public static TBuilder ExigirAdmin<TBuilder>(this TBuilder construtor) where TBuilder : IEndpointConventionBuilder =>
        construtor.AddEndpointFilter(async (contexto, seguinte) =>
        {
            var http = contexto.HttpContext;
            http.Response.Headers.CacheControl = "no-store";
            var conta = await ObterContaAsync(http, http.RequestAborted);
            if (conta is null)
                return Results.Json(new { erro = "Inicia sessão para continuar." }, statusCode: StatusCodes.Status401Unauthorized);
            if (!conta.Admin)
                return Results.Json(new { erro = "Só quem administra a app pode fazer isto." }, statusCode: StatusCodes.Status403Forbidden);
            return await seguinte(contexto);
        });

    /// <summary>
    /// Rotas /jogos/{id}/...: deixa passar o dono do jogo (sessão) ou quem trouxer o código do link de partilha (?c=...).
    /// Para todos os outros o jogo "não existe" (404), para não revelar que existe.
    /// </summary>
    public static TBuilder ExigirAcessoAoJogo<TBuilder>(this TBuilder construtor) where TBuilder : IEndpointConventionBuilder =>
        construtor.AddEndpointFilter(async (contexto, seguinte) =>
        {
            var http = contexto.HttpContext;
            if (http.GetRouteValue("id") is not { } valor || !int.TryParse(valor.ToString(), out var jogoId))
                return Results.NotFound(new { erro = "Jogo não encontrado." });

            var conta = await ObterContaAsync(http, http.RequestAborted);
            var acesso = http.RequestServices.GetRequiredService<AcessoService>();
            var pode = await acesso.PodeVerJogoAsync(jogoId, http.Request.Query["c"].ToString(), conta?.Id, http.RequestAborted);
            if (!pode)
                return Results.NotFound(new { erro = "Jogo não encontrado." });
            return await seguinte(contexto);
        });
}
