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

    // ------------------------- Local na baliza (defesa ou golo) -------------------------

    [Theory]
    [InlineData("DEFESA")]
    [InlineData("GOLO")]
    public void Defesa_e_golo_com_local_na_baliza_sao_validos(string resultado)
    {
        Assert.Empty(EventoValidador.Validar(Remate(resultado: resultado, balizaX: 20, balizaY: 80), eRemate: true));
    }

    [Theory]
    [InlineData("DEFESA")]
    [InlineData("GOLO")]
    public void Sem_local_na_baliza_continua_valido(string resultado)
    {
        Assert.Empty(EventoValidador.Validar(Remate(resultado: resultado), eRemate: true));
    }

    [Theory]
    [InlineData("DEFESA", 0, 0)]
    [InlineData("DEFESA", 100, 100)]
    [InlineData("GOLO", 0, 0)]
    [InlineData("GOLO", 100, 100)]
    public void Os_limites_da_baliza_sao_aceites(string resultado, double x, double y)
    {
        Assert.Empty(EventoValidador.Validar(Remate(resultado: resultado, balizaX: (decimal)x, balizaY: (decimal)y), eRemate: true));
    }

    [Theory]
    [InlineData("DEFESA", -1, 50)]
    [InlineData("DEFESA", 101, 50)]
    [InlineData("GOLO", 50, -0.5)]
    [InlineData("GOLO", 50, 100.5)]
    public void Local_fora_da_baliza_e_invalido(string resultado, double x, double y)
    {
        var erros = EventoValidador.Validar(Remate(resultado: resultado, balizaX: (decimal)x, balizaY: (decimal)y), eRemate: true);
        Assert.Contains(erros, e => e.Contains("balizaX"));
    }

    [Theory]
    [InlineData("DEFESA")]
    [InlineData("GOLO")]
    public void Os_dois_pontos_da_baliza_vem_juntos(string resultado)
    {
        Assert.Contains(EventoValidador.Validar(Remate(resultado: resultado, balizaX: 20), eRemate: true), e => e.Contains("balizaX"));
        Assert.Contains(EventoValidador.Validar(Remate(resultado: resultado, balizaY: 20), eRemate: true), e => e.Contains("balizaX"));
    }

    [Theory]
    [InlineData("FORA")]
    [InlineData("POSTE")]
    [InlineData("BLOQUEADO")]
    public void Local_na_baliza_so_existe_numa_defesa_ou_num_golo(string resultado)
    {
        var erros = EventoValidador.Validar(Remate(resultado: resultado, balizaX: 50, balizaY: 50), eRemate: true);
        Assert.Contains(erros, e => e.Contains("só existe numa defesa ou num golo"));
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

    // ------------------------- Sistema defensivo do adversário -------------------------

    [Theory]
    [InlineData("6_0")]
    [InlineData("5_1")]
    [InlineData("3_2_1")]
    [InlineData("4_2")]
    [InlineData("INDIVIDUAL")]
    public void Todos_os_sistemas_defensivos_conhecidos_sao_aceites_num_remate_posicional(string sistema)
    {
        Assert.Empty(EventoValidador.Validar(Remate(situacao: "POSICIONAL") with { SistemaDefensivo = sistema }, eRemate: true));
        // sem situação conta como posicional
        Assert.Empty(EventoValidador.Validar(Remate() with { SistemaDefensivo = sistema }, eRemate: true));
    }

    [Fact]
    public void Sistema_defensivo_e_opcional()
    {
        Assert.Empty(EventoValidador.Validar(Remate(), eRemate: true));
    }

    [Theory]
    [InlineData("6:0")]
    [InlineData("ZONA")]
    [InlineData("")]
    public void Sistema_defensivo_desconhecido_e_invalido(string sistema)
    {
        var erros = EventoValidador.Validar(Remate() with { SistemaDefensivo = sistema }, eRemate: true);
        Assert.Contains(erros, e => e.Contains("sistemaDefensivo"));
    }

    [Theory]
    [InlineData("CONTRA_ATAQUE")]
    [InlineData("SETE_METROS")]
    public void Sistema_defensivo_so_existe_em_ataque_posicional(string situacao)
    {
        var erros = EventoValidador.Validar(Remate(situacao: situacao) with { SistemaDefensivo = "6_0" }, eRemate: true);
        Assert.Contains(erros, e => e.Contains("ataque posicional"));
    }

    [Fact]
    public void Evento_que_nao_e_remate_nao_aceita_sistema_defensivo()
    {
        var invalido = new NovoEventoRequest("PERDA_BOLA", 1, 5, null, null, null, null, null, 1, 450) { SistemaDefensivo = "6_0" };
        Assert.NotEmpty(EventoValidador.Validar(invalido, eRemate: false));
    }
}
