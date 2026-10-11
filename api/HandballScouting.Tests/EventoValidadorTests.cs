using HandballScouting.Api;

namespace HandballScouting.Tests;

public class EventoValidadorTests
{
    private static NovoEventoRequest Remate(
        int? jogadorId = 4, string? resultado = "GOLO", decimal? x = 50, decimal? y = 40,
        short parte = 1, int segundo = 600, string? situacao = null, int? gr = 9) =>
        new("REMATE", 1, jogadorId, gr, resultado, situacao, x, y, parte, segundo);

    [Fact]
    public void Remate_valido_nao_tem_erros()
    {
        Assert.Empty(EventoValidador.Validar(Remate(), eRemate: true));
    }

    [Theory]
    [InlineData("GOLO")]
    [InlineData("DEFESA")]
    [InlineData("FORA")]
    [InlineData("POSTE")]
    [InlineData("BLOQUEADO")]
    public void Todos_os_resultados_conhecidos_sao_aceites(string resultado)
    {
        Assert.Empty(EventoValidador.Validar(Remate(resultado: resultado), eRemate: true));
    }

    [Fact]
    public void Remate_sem_jogador_e_invalido()
    {
        var erros = EventoValidador.Validar(Remate(jogadorId: null), eRemate: true);
        Assert.Contains(erros, e => e.Contains("jogadorId"));
    }

    [Fact]
    public void Remate_com_resultado_desconhecido_e_invalido()
    {
        var erros = EventoValidador.Validar(Remate(resultado: "ENTROU"), eRemate: true);
        Assert.Contains(erros, e => e.Contains("resultado"));
    }

    [Theory]
    [InlineData(-1, 50)]
    [InlineData(101, 50)]
    [InlineData(50, -0.5)]
    [InlineData(50, 100.5)]
    public void Coordenadas_fora_do_campo_sao_invalidas(double x, double y)
    {
        var erros = EventoValidador.Validar(Remate(x: (decimal)x, y: (decimal)y), eRemate: true);
        Assert.Contains(erros, e => e.Contains("x e y"));
    }

    [Fact]
    public void Remate_sem_coordenadas_e_invalido()
    {
        var erros = EventoValidador.Validar(Remate(x: null, y: null), eRemate: true);
        Assert.Contains(erros, e => e.Contains("x e y"));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(3)]
    public void Parte_tem_de_ser_1_ou_2(short parte)
    {
        var erros = EventoValidador.Validar(Remate(parte: parte), eRemate: true);
        Assert.Contains(erros, e => e.Contains("parte"));
    }

    [Fact]
    public void Situacao_desconhecida_e_invalida()
    {
        var erros = EventoValidador.Validar(Remate(situacao: "LIVRE"), eRemate: true);
        Assert.Contains(erros, e => e.Contains("situacao"));
    }

    [Fact]
    public void Falta_ofensiva_sem_coordenadas_e_valida()
    {
        var falta = new NovoEventoRequest("FALTA_OFENSIVA", 1, 5, null, null, null, null, null, 1, 450);
        Assert.Empty(EventoValidador.Validar(falta, eRemate: false));
    }

    [Fact]
    public void Evento_que_nao_e_remate_nao_aceita_resultado_nem_coordenadas()
    {
        var invalido = new NovoEventoRequest("PERDA_BOLA", 1, 5, null, "GOLO", null, 50, 50, 1, 450);
        Assert.NotEmpty(EventoValidador.Validar(invalido, eRemate: false));
    }
}
