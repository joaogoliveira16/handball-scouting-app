namespace HandballScouting.Api;

/// <summary>
/// A que horas fica registado um evento. Com rede é "agora". Sem rede, o tablet guarda o evento e envia-o mais tarde
/// com a hora a que o adjunto o registou (<c>ocorridoEm</c>), para o Excel e a lista de jogos em direto não ficarem
/// com a hora do reenvio. O relógio do tablet não é de confiança, por isso a hora é limitada.
/// </summary>
public static class InstanteEvento
{
    /// <summary>Um evento mais antigo do que isto leva a hora do envio (um tablet com o relógio muito atrasado).</summary>
    public static readonly TimeSpan IdadeMaxima = TimeSpan.FromHours(12);

    public static DateTimeOffset Calcular(DateTimeOffset? ocorridoEm, DateTimeOffset agora)
    {
        var utc = agora.ToUniversalTime();
        if (ocorridoEm is not { } hora) return utc;
        if (hora > agora) return utc;                       // relógio do tablet adiantado: nunca no futuro
        if (agora - hora > IdadeMaxima) return utc;
        return hora.ToUniversalTime();
    }
}
