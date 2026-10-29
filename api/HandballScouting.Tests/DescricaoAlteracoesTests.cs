using HandballScouting.Api;

namespace HandballScouting.Tests;

public class DescricaoAlteracoesTests
{
    private static readonly JogoDetalhe Jogo = new()
    {
        Id = 1, CasaId = 10, CasaNome = "Leões", ForaId = 20, ForaNome = "Falcões",
    };

    /// <summary>Um golo do #7 João Silva, dos Leões, aos 45:20 da 2.ª parte.</summary>
    private static EventoEditavel Golo(Action<EventoEditavel>? alterar = null)
    {
        var e = new EventoEditavel
        {
            Id = 5, EquipaId = 10, TipoEvento = "REMATE", TipoNome = "Remate", ERemate = true,
            JogadorId = 70, JogadorNumero = 7, JogadorNome = "João Silva",
            Resultado = "GOLO", Situacao = "POSICIONAL", Parte = 2, SegundoJogo = 45 * 60 + 20,
        };
        alterar?.Invoke(e);
        return e;
    }

    [Theory]
    [InlineData(0, "00:00")]
    [InlineData(5, "00:05")]
    [InlineData(135, "02:15")]
    [InlineData(2720, "45:20")]
    [InlineData(3599, "59:59")]
    [InlineData(3600, "60:00")]
    [InlineData(-30, "00:00")]
    public void O_minuto_tem_sempre_dois_digitos(int segundos, string esperado)
    {
        Assert.Equal(esperado, DescricaoAlteracoes.Minuto(segundos));
    }

    [Fact]
    public void O_tempo_leva_a_parte_e_o_minuto()
    {
        Assert.Equal("2.ª 45:20", DescricaoAlteracoes.Tempo(Golo()));
        Assert.Equal("1.ª 00:00", DescricaoAlteracoes.Tempo(Golo(e => { e.Parte = 1; e.SegundoJogo = 0; })));
    }

    [Theory]
    [InlineData(2, 14, 3, "dora@exemplo.pt (Dora): 2 equipas, 14 jogadores e 3 jogos eliminados")]
    [InlineData(1, 1, 1, "dora@exemplo.pt (Dora): 1 equipa, 1 jogador e 1 jogo eliminados")]
    [InlineData(0, 0, 0, "dora@exemplo.pt (Dora): 0 equipas, 0 jogadores e 0 jogos eliminados")]
    public void Uma_conta_eliminada_diz_quem_era_e_o_que_saiu_com_ela(int equipas, int jogadores, int jogos, string esperado)
    {
        var conta = new UtilizadorAdmin { Id = 4, Nome = "Dora", Email = "dora@exemplo.pt" };
        var saiu = new ContaEliminada { EquipasEliminadas = equipas, JogadoresEliminados = jogadores, JogosEliminados = jogos };
        Assert.Equal(esperado, DescricaoAlteracoes.ContaEliminada(conta, saiu));
    }

    [Fact]
    public void O_jogo_diz_as_equipas_e_a_conta_dona()
    {
        Assert.Equal("Leões vs Falcões (conta Ana)", DescricaoAlteracoes.Jogo(Jogo, "Ana"));
    }

    [Fact]
    public void O_evento_diz_quando_o_que_foi_quem_e_de_que_equipa()
    {
        Assert.Equal("2.ª 45:20 · Golo · #7 João Silva · Leões", DescricaoAlteracoes.Evento(Golo(), Jogo));
    }

    [Fact]
    public void Um_evento_da_equipa_de_fora_leva_o_nome_do_adversario()
    {
        Assert.Equal("2.ª 45:20 · Golo · #7 João Silva · Falcões", DescricaoAlteracoes.Evento(Golo(e => e.EquipaId = 20), Jogo));
    }

    [Fact]
    public void Sem_resultado_o_evento_usa_o_nome_do_tipo_e_sem_jogador_diz_isso()
    {
        var falta = Golo(e =>
        {
            e.TipoEvento = "FALTA"; e.TipoNome = "Falta"; e.ERemate = false; e.Resultado = null;
            e.JogadorId = null; e.JogadorNumero = null; e.JogadorNome = null;
        });
        Assert.Equal("2.ª 45:20 · Falta · sem jogador · Leões", DescricaoAlteracoes.Evento(falta, Jogo));
    }

    [Fact]
    public void Um_jogador_sem_nome_fica_so_com_o_numero()
    {
        Assert.Equal("2.ª 45:20 · Golo · #7 · Leões", DescricaoAlteracoes.Evento(Golo(e => e.JogadorNome = null), Jogo));
    }

    [Theory]
    [InlineData("GOLO", "Golo")]
    [InlineData("DEFESA", "Defesa")]
    [InlineData("FORA", "Fora")]
    [InlineData("POSTE", "Poste")]
    [InlineData("BLOQUEADO", "Bloqueado")]
    [InlineData("OUTRO", "OUTRO")]   // um código que não conhece aparece como está, em vez de rebentar
    public void Os_resultados_aparecem_em_portugues(string codigo, string esperado)
    {
        Assert.Equal($"2.ª 45:20 · {esperado} · #7 João Silva · Leões", DescricaoAlteracoes.Evento(Golo(e => e.Resultado = codigo), Jogo));
    }

    [Fact]
    public void Sem_nada_a_mudar_diz_que_nao_ha_alteracoes()
    {
        Assert.Equal("2.ª 45:20 · Golo · #7 João Silva · Leões: sem alterações", DescricaoAlteracoes.Correcao(Golo(), Golo(), Jogo));
    }

    [Fact]
    public void Corrigir_o_resultado_diz_de_que_para_que()
    {
        var antes = Golo(e => e.Resultado = "FORA");
        var depois = Golo();
        Assert.Equal("2.ª 45:20 · Fora · #7 João Silva · Leões: resultado de Fora para Golo", DescricaoAlteracoes.Correcao(antes, depois, Jogo));
    }

    [Fact]
    public void Corrigir_o_jogador_mostra_numero_e_nome_dos_dois()
    {
        var antes = Golo(e => { e.JogadorNumero = 71; e.JogadorNome = "Rui Admin"; });
        var depois = Golo(e => { e.JogadorNumero = 72; e.JogadorNome = "Tiago Admin"; });
        Assert.EndsWith(": jogador de #71 Rui Admin para #72 Tiago Admin", DescricaoAlteracoes.Correcao(antes, depois, Jogo));
    }

    [Fact]
    public void Tirar_ou_por_o_jogador_diz_sem_jogador()
    {
        var com = Golo();
        var sem = Golo(e => { e.JogadorNumero = null; e.JogadorNome = null; });
        Assert.EndsWith(": jogador de #7 João Silva para sem jogador", DescricaoAlteracoes.Correcao(com, sem, Jogo));
        Assert.EndsWith(": jogador de sem jogador para #7 João Silva", DescricaoAlteracoes.Correcao(sem, com, Jogo));
    }

    [Fact]
    public void Corrigir_o_guarda_redes()
    {
        var antes = Golo();
        var depois = Golo(e => { e.GuardaRedesId = 1; e.GuardaRedesNumero = 1; e.GuardaRedesNome = "Zé"; });
        Assert.EndsWith(": guarda-redes de sem jogador para #1 Zé", DescricaoAlteracoes.Correcao(antes, depois, Jogo));
    }

    [Fact]
    public void Corrigir_a_equipa_e_o_tipo()
    {
        var antes = Golo();
        var depois = Golo(e => { e.EquipaId = 20; e.TipoNome = "Passe"; });
        Assert.Equal("2.ª 45:20 · Golo · #7 João Silva · Leões: equipa de Leões para Falcões; tipo de Remate para Passe",
            DescricaoAlteracoes.Correcao(antes, depois, Jogo));
    }

    [Theory]
    [InlineData("POSICIONAL", "CONTRA_ATAQUE", "situação de Posicional para Contra-ataque")]
    [InlineData("CONTRA_ATAQUE", "SETE_METROS", "situação de Contra-ataque para 7 metros")]
    public void Corrigir_a_situacao(string de, string para, string esperado)
    {
        Assert.EndsWith($": {esperado}", DescricaoAlteracoes.Correcao(Golo(e => e.Situacao = de), Golo(e => e.Situacao = para), Jogo));
    }

    [Theory]
    [InlineData(null, "6_0", "defesa do adversário de não indicado para 6:0")]
    [InlineData("6_0", "3_2_1", "defesa do adversário de 6:0 para 3:2:1")]
    [InlineData("INDIVIDUAL", null, "defesa do adversário de Individual para não indicado")]
    public void Corrigir_a_defesa_do_adversario(string? de, string? para, string esperado)
    {
        Assert.EndsWith($": {esperado}", DescricaoAlteracoes.Correcao(Golo(e => e.SistemaDefensivo = de), Golo(e => e.SistemaDefensivo = para), Jogo));
    }

    [Fact]
    public void Corrigir_o_tempo()
    {
        var antes = Golo(e => { e.Parte = 1; e.SegundoJogo = 120; });
        var depois = Golo(e => { e.Parte = 1; e.SegundoJogo = 185; });
        Assert.Equal("1.ª 02:00 · Golo · #7 João Silva · Leões: tempo de 1.ª 02:00 para 1.ª 03:05",
            DescricaoAlteracoes.Correcao(antes, depois, Jogo));
    }

    [Fact]
    public void Mudar_o_local_no_campo_ou_na_baliza_diz_so_que_mudou()
    {
        var antes = Golo(e => { e.X = 10.5m; e.Y = 20m; e.BalizaX = 1m; e.BalizaY = 2m; });
        var campo = Golo(e => { e.X = 12m; e.Y = 20m; e.BalizaX = 1m; e.BalizaY = 2m; });
        var baliza = Golo(e => { e.X = 10.5m; e.Y = 20m; e.BalizaX = 1m; e.BalizaY = 3m; });
        var ambos = Golo(e => { e.X = 10.5m; e.Y = 25m; e.BalizaX = 2m; e.BalizaY = 2m; });
        Assert.EndsWith(": local no campo alterado", DescricaoAlteracoes.Correcao(antes, campo, Jogo));
        Assert.EndsWith(": local na baliza alterado", DescricaoAlteracoes.Correcao(antes, baliza, Jogo));
        Assert.EndsWith(": local no campo alterado; local na baliza alterado", DescricaoAlteracoes.Correcao(antes, ambos, Jogo));
    }

    [Fact]
    public void Coordenadas_iguais_ou_ambas_vazias_nao_contam_como_alteracao()
    {
        var a = Golo(e => { e.X = 10.5m; e.Y = 20m; });
        var b = Golo(e => { e.X = 10.5m; e.Y = 20m; });
        Assert.EndsWith(": sem alterações", DescricaoAlteracoes.Correcao(a, b, Jogo));
        Assert.EndsWith(": sem alterações", DescricaoAlteracoes.Correcao(Golo(), Golo(), Jogo));
        Assert.EndsWith(": local no campo alterado", DescricaoAlteracoes.Correcao(Golo(), a, Jogo));
    }

    [Fact]
    public void Varias_alteracoes_juntam_se_pela_ordem_do_formulario_com_ponto_e_virgula()
    {
        var antes = Golo(e => { e.Resultado = "DEFESA"; e.JogadorNumero = 7; e.JogadorNome = "João"; });
        var depois = Golo(e => { e.Resultado = "GOLO"; e.JogadorNumero = 9; e.JogadorNome = "Rui"; e.SistemaDefensivo = "5_1"; e.SegundoJogo = 2800; });
        Assert.Equal(
            "2.ª 45:20 · Defesa · #7 João · Leões: resultado de Defesa para Golo; jogador de #7 João para #9 Rui; "
            + "defesa do adversário de não indicado para 5:1; tempo de 2.ª 45:20 para 2.ª 46:40",
            DescricaoAlteracoes.Correcao(antes, depois, Jogo));
    }
}
