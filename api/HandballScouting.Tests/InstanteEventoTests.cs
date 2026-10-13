using HandballScouting.Api;

namespace HandballScouting.Tests;

public class InstanteEventoTests
{
    private static readonly DateTimeOffset Agora = new(2026, 10, 11, 21, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Sem_hora_do_tablet_vale_a_hora_do_envio()
    {
        Assert.Equal(Agora, InstanteEvento.Calcular(null, Agora));
    }

    [Fact]
    public void Um_evento_guardado_sem_rede_mantem_a_hora_em_que_aconteceu()
    {
        var ocorrido = Agora.AddMinutes(-7);
        Assert.Equal(ocorrido, InstanteEvento.Calcular(ocorrido, Agora));
    }

    [Fact]
    public void A_hora_e_devolvida_em_utc_mesmo_com_outro_fuso()
    {
        var ocorrido = new DateTimeOffset(2026, 10, 11, 21, 55, 0, TimeSpan.FromHours(1));   // 20:55 UTC
        var r = InstanteEvento.Calcular(ocorrido, Agora);
        Assert.Equal(TimeSpan.Zero, r.Offset);
        Assert.Equal(Agora.AddMinutes(-5), r);
    }

    [Fact]
    public void Um_tablet_com_o_relogio_adiantado_nunca_regista_no_futuro()
    {
        Assert.Equal(Agora, InstanteEvento.Calcular(Agora.AddMinutes(3), Agora));
    }

    [Fact]
    public void Um_evento_com_mais_de_12_horas_leva_a_hora_do_envio()
    {
        Assert.Equal(Agora, InstanteEvento.Calcular(Agora.AddHours(-12).AddSeconds(-1), Agora));
        var noLimite = Agora.AddHours(-12);
        Assert.Equal(noLimite, InstanteEvento.Calcular(noLimite, Agora));
    }

    [Fact]
    public void Um_cliente_id_vazio_e_invalido_e_um_normal_e_aceite()
    {
        NovoEventoRequest Pedido(Guid? clienteId) =>
            new("TIMEOUT", 1, null, null, null, null, null, null, 1, 600, ClienteId: clienteId);
        Assert.Contains(EventoValidador.Validar(Pedido(Guid.Empty), eRemate: false), e => e.Contains("clienteId"));
        Assert.Empty(EventoValidador.Validar(Pedido(Guid.NewGuid()), eRemate: false));
        Assert.Empty(EventoValidador.Validar(Pedido(null), eRemate: false));
    }

    [Fact]
    public void Um_reenvio_responde_200_com_o_evento_que_ja_existia()
    {
        var primeiro = ResultadoRegisto.Sucesso(41);
        var repetido = ResultadoRegisto.JaRegistado(41);
        Assert.Equal(201, primeiro.Status);
        Assert.False(primeiro.Repetido);
        Assert.Equal(200, repetido.Status);
        Assert.True(repetido.Repetido);
        Assert.Equal(41L, repetido.Id);
    }
}
