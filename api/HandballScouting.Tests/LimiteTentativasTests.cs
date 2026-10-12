using HandballScouting.Api;

namespace HandballScouting.Tests;

public class LimiteTentativasTests
{
    private sealed class RelogioFalso : TimeProvider
    {
        public DateTimeOffset Agora { get; set; } = new(2026, 10, 12, 20, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Agora;
    }

    [Fact]
    public void Ate_ao_maximo_de_falhas_nao_bloqueia()
    {
        var limite = new LimiteTentativas(new RelogioFalso(), maximo: 5);
        for (var i = 0; i < 4; i++) limite.RegistarFalha("ana@exemplo.pt");
        Assert.False(limite.Bloqueado("ana@exemplo.pt"));
        limite.RegistarFalha("ana@exemplo.pt");
        Assert.True(limite.Bloqueado("ana@exemplo.pt"));
    }

    [Fact]
    public void O_bloqueio_e_so_para_o_email_que_falhou()
    {
        var limite = new LimiteTentativas(new RelogioFalso(), maximo: 2);
        limite.RegistarFalha("a@exemplo.pt");
        limite.RegistarFalha("a@exemplo.pt");
        Assert.True(limite.Bloqueado("a@exemplo.pt"));
        Assert.False(limite.Bloqueado("b@exemplo.pt"));
    }

    [Fact]
    public void O_bloqueio_acaba_quando_a_janela_passa()
    {
        var relogio = new RelogioFalso();
        var limite = new LimiteTentativas(relogio, maximo: 3, janela: TimeSpan.FromMinutes(10));
        for (var i = 0; i < 3; i++) limite.RegistarFalha("ana@exemplo.pt");
        Assert.True(limite.Bloqueado("ana@exemplo.pt"));

        relogio.Agora += TimeSpan.FromMinutes(9);
        Assert.True(limite.Bloqueado("ana@exemplo.pt"));
        relogio.Agora += TimeSpan.FromMinutes(2);
        Assert.False(limite.Bloqueado("ana@exemplo.pt"));
    }

    [Fact]
    public void Falhas_antigas_nao_se_somam_as_novas()
    {
        var relogio = new RelogioFalso();
        var limite = new LimiteTentativas(relogio, maximo: 3, janela: TimeSpan.FromMinutes(10));
        limite.RegistarFalha("ana@exemplo.pt");
        limite.RegistarFalha("ana@exemplo.pt");
        relogio.Agora += TimeSpan.FromMinutes(11);
        limite.RegistarFalha("ana@exemplo.pt");   // volta a contar do zero
        Assert.False(limite.Bloqueado("ana@exemplo.pt"));
    }

    [Fact]
    public void Entrar_com_sucesso_limpa_as_falhas()
    {
        var limite = new LimiteTentativas(new RelogioFalso(), maximo: 3);
        limite.RegistarFalha("ana@exemplo.pt");
        limite.RegistarFalha("ana@exemplo.pt");
        limite.Limpar("ana@exemplo.pt");
        limite.RegistarFalha("ana@exemplo.pt");
        Assert.False(limite.Bloqueado("ana@exemplo.pt"));
    }
}
