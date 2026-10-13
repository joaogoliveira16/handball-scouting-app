using HandballScouting.Api;

namespace HandballScouting.Tests;

public class EventoValidadorTests
{
    private static NovoEventoRequest Remate(
        int? jogadorId = 4, string? resultado = "GOLO", decimal? x = 50, decimal? y = 40,
        short parte = 1, int segundo = 600, string? situacao = null, int? gr = 9,
        decimal? balizaX = null, decimal? balizaY = null) =>
        new("REMATE", 1, jogadorId, gr, resultado, situacao, x, y, parte, segundo, balizaX, balizaY);

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

    // ------------------------- Local da defesa na baliza -------------------------

    [Fact]
    public void Defesa_com_local_na_baliza_e_valida()
    {
        Assert.Empty(EventoValidador.Validar(Remate(resultado: "DEFESA", balizaX: 20, balizaY: 80), eRemate: true));
    }

    [Fact]
    public void Defesa_sem_local_na_baliza_continua_valida()
    {
        Assert.Empty(EventoValidador.Validar(Remate(resultado: "DEFESA"), eRemate: true));
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(100, 100)]
    public void Os_limites_da_baliza_sao_aceites(double x, double y)
    {
        Assert.Empty(EventoValidador.Validar(Remate(resultado: "DEFESA", balizaX: (decimal)x, balizaY: (decimal)y), eRemate: true));
    }

    [Theory]
    [InlineData(-1, 50)]
    [InlineData(101, 50)]
    [InlineData(50, -0.5)]
    [InlineData(50, 100.5)]
    public void Local_fora_da_baliza_e_invalido(double x, double y)
    {
        var erros = EventoValidador.Validar(Remate(resultado: "DEFESA", balizaX: (decimal)x, balizaY: (decimal)y), eRemate: true);
        Assert.Contains(erros, e => e.Contains("balizaX"));
    }

    [Fact]
    public void Os_dois_pontos_da_baliza_vem_juntos()
    {
        Assert.Contains(EventoValidador.Validar(Remate(resultado: "DEFESA", balizaX: 20), eRemate: true), e => e.Contains("balizaX"));
        Assert.Contains(EventoValidador.Validar(Remate(resultado: "DEFESA", balizaY: 20), eRemate: true), e => e.Contains("balizaX"));
    }

    [Theory]
    [InlineData("GOLO")]
    [InlineData("FORA")]
    [InlineData("POSTE")]
    [InlineData("BLOQUEADO")]
    public void Local_na_baliza_so_existe_numa_defesa(string resultado)
    {
        var erros = EventoValidador.Validar(Remate(resultado: resultado, balizaX: 50, balizaY: 50), eRemate: true);
        Assert.Contains(erros, e => e.Contains("só existe numa defesa"));
    }

    [Fact]
    public void Evento_que_nao_e_remate_nao_aceita_local_na_baliza()
    {
        var invalido = new NovoEventoRequest("PERDA_BOLA", 1, 5, null, null, null, null, null, 1, 450, 50, 50);
        Assert.NotEmpty(EventoValidador.Validar(invalido, eRemate: false));
    }

    [Fact]
    public void Vermelho_direto_exige_o_jogador()
    {
        var semJogador = new NovoEventoRequest("VERMELHO", 1, null, null, null, null, null, null, 2, 2100);
        Assert.Contains(EventoValidador.Validar(semJogador, eRemate: false), e => e.Contains("vermelho"));
        var comJogador = semJogador with { JogadorId = 5 };
        Assert.Empty(EventoValidador.Validar(comJogador, eRemate: false));
    }

    [Fact]
    public void Dois_minutos_sem_jogador_continuam_validos()
    {
        // pode ser uma sanção ao treinador ou a um oficial: só o vermelho exige jogador
        var dois = new NovoEventoRequest("DOIS_MINUTOS", 1, null, null, null, null, null, null, 1, 900);
        Assert.Empty(EventoValidador.Validar(dois, eRemate: false));
    }

    [Fact]
    public void Vermelho_direto_nao_tem_posicao_no_campo()
    {
        var invalido = new NovoEventoRequest("VERMELHO", 1, 5, null, null, null, 50, 50, 2, 2100);
        Assert.NotEmpty(EventoValidador.Validar(invalido, eRemate: false));
    }
}
