namespace HandballScouting.Api;

/// <summary>
/// Trava o envio de emails de confirmação: poucos pedidos por endereço (ninguém usa a app para encher a caixa
/// de correio de outra pessoa) e um teto geral por hora (protege a conta de SMTP). Fica em memória.
/// </summary>
public sealed class LimiteEnvios(
    TimeProvider relogio, int maximoPorEmail = 3, TimeSpan? janelaEmail = null, int maximoGeral = 100, TimeSpan? janelaGeral = null)
{
    private const string ChaveGeral = "*";
    private readonly LimiteTentativas _porEmail = new(relogio, maximoPorEmail, janelaEmail ?? TimeSpan.FromMinutes(15));
    private readonly LimiteTentativas _geral = new(relogio, maximoGeral, janelaGeral ?? TimeSpan.FromHours(1));

    /// <summary>Ainda se pode pedir outro email para este endereço?</summary>
    public bool PodePedir(string email) => !_porEmail.Bloqueado(email);

    /// <summary>Conta um pedido para este endereço (exista ou não uma conta com ele: não se revela qual).</summary>
    public void RegistarPedido(string email) => _porEmail.RegistarFalha(email);

    /// <summary>Ainda há margem no teto geral de emails por hora?</summary>
    public bool PodeEnviar() => !_geral.Bloqueado(ChaveGeral);

    /// <summary>Conta um email enviado de facto.</summary>
    public void RegistarEnvio() => _geral.RegistarFalha(ChaveGeral);
}
