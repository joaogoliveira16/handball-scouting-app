using HandballScouting.Api;

namespace HandballScouting.Tests;

public class LimiteEnviosTests
{
    private sealed class RelogioFalso : TimeProvider
    {
        public DateTimeOffset Agora { get; set; } = new(2026, 10, 12, 20, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Agora;
    }

    [Fact]
    public void Cada_endereco_tem_poucos_pedidos_por_janela()
    {
        var limite = new LimiteEnvios(new RelogioFalso(), maximoPorEmail: 3);
        for (var i = 0; i < 3; i++)
        {
            Assert.True(limite.PodePedir("ana@exemplo.pt"));
            limite.RegistarPedido("ana@exemplo.pt");
        }
        Assert.False(limite.PodePedir("ana@exemplo.pt"));
        Assert.True(limite.PodePedir("bruno@exemplo.pt"));
    }

    [Fact]
    public void Os_pedidos_voltam_a_ser_aceites_quando_a_janela_passa()
    {
        var relogio = new RelogioFalso();
        var limite = new LimiteEnvios(relogio, maximoPorEmail: 1, janelaEmail: TimeSpan.FromMinutes(15));
        limite.RegistarPedido("ana@exemplo.pt");
        Assert.False(limite.PodePedir("ana@exemplo.pt"));
        relogio.Agora += TimeSpan.FromMinutes(16);
        Assert.True(limite.PodePedir("ana@exemplo.pt"));
    }

    [Fact]
    public void Ha_um_teto_geral_de_emails_por_hora()
    {
        var relogio = new RelogioFalso();
        var limite = new LimiteEnvios(relogio, maximoGeral: 2, janelaGeral: TimeSpan.FromHours(1));
        Assert.True(limite.PodeEnviar());
        limite.RegistarEnvio();
        limite.RegistarEnvio();
        Assert.False(limite.PodeEnviar());
        relogio.Agora += TimeSpan.FromHours(1) + TimeSpan.FromSeconds(1);
        Assert.True(limite.PodeEnviar());
    }

    [Fact]
    public void Pedidos_nao_gastam_o_teto_geral()
    {
        var limite = new LimiteEnvios(new RelogioFalso(), maximoPorEmail: 10, maximoGeral: 1);
        for (var i = 0; i < 5; i++) limite.RegistarPedido($"{i}@exemplo.pt");
        Assert.True(limite.PodeEnviar());
    }
}
