using HandballScouting.Api;

namespace HandballScouting.Tests;

public class AssistenteTests
{
    private const int Casa = 1, Fora = 2;

    private static long _proximoId = 1000;

    /// <summary>Um jogo vazio entre "Casa FC" e "Fora AC", com o relógio no segundo indicado.</summary>
    private static EstatisticasJogo Jogo(int segundo = 0, bool relogioUsado = true) => new()
    {
        Equipas =
        {
            new ResumoEquipa { EquipaId = Casa, Nome = "Casa FC", ECasa = true },
            new ResumoEquipa { EquipaId = Fora, Nome = "Fora AC" },
        },
        ParcialMinutos = 5,
        Relogio = new RelogioJogo { Segundo = segundo },
        Numerica = new NumericaJogo { RelogioUsado = relogioUsado },
    };

    private static RemateMapa Golo(int equipa, int segundo, long? id = null) =>
        new() { Id = id ?? _proximoId++, EquipaId = equipa, SegundoJogo = segundo, Resultado = "GOLO", Situacao = "POSICIONAL" };

    private static TimeoutJogo Timeout(int equipa, short parte, long? id = null, int segundo = 0) =>
        new() { EventoId = id ?? _proximoId++, EquipaId = equipa, Parte = parte, SegundoJogo = segundo };

    private static readonly IReadOnlyList<TimeoutJogo> SemTimeouts = new List<TimeoutJogo>();

    private static Sugestao? Com(AssistenteJogo a, string codigo, int? equipa = null) =>
        a.Sugestoes.FirstOrDefault(s => s.Codigo == codigo && (equipa is null || s.EquipaId == equipa));

    private static EstatJogador Jogador(int equipa, int id, int numero, long remates, long golos) =>
        new() { JogadorId = id, EquipaId = equipa, Numero = (short)numero, Nome = $"Jogador {numero}", Remates = remates, Golos = golos };

    private static EstatGuardaRedes GuardaRedes(int equipa, int id, long defesas, long golosSofridos) =>
        new() { JogadorId = id, EquipaId = equipa, Numero = 1, Nome = "Guarda-redes", Defesas = defesas, GolosSofridos = golosSofridos, RematesBaliza = defesas + golosSofridos };

    // ---------------------------------------------------------------- jogo calmo

    [Fact]
    public void Um_jogo_sem_eventos_nao_tem_sugestoes_e_cada_equipa_tem_os_time_outs_todos()
    {
        var a = Assistente.Calcular(Jogo(), SemTimeouts);
        Assert.Empty(a.Sugestoes);
        Assert.Equal(2, a.Timeouts.Count);
        Assert.All(a.Timeouts, t => Assert.Equal(0, t.Usados));
        Assert.All(a.Timeouts, t => Assert.Equal(2, t.Restantes));   // no máximo 2 por parte, mesmo havendo 3 no jogo
    }

    [Fact]
    public void Com_menos_de_duas_equipas_nao_ha_nada_a_dizer()
    {
        var e = Jogo();
        e.Equipas.RemoveAt(1);
        var a = Assistente.Calcular(e, SemTimeouts);
        Assert.Empty(a.Sugestoes);
        Assert.Empty(a.Timeouts);
    }

    // ---------------------------------------------------------------- time-outs

    [Fact]
    public void Quatro_golos_seguidos_do_adversario_sugerem_time_out_a_equipa_que_sofre()
    {
        var e = Jogo(900);
        e.Remates.AddRange(new[] { Golo(Casa, 100), Golo(Fora, 300), Golo(Fora, 400), Golo(Fora, 500), Golo(Fora, 600) });
        var a = Assistente.Calcular(e, SemTimeouts);

        var s = Com(a, "TIMEOUT");
        Assert.NotNull(s);
        Assert.Equal(Casa, s!.EquipaId);
        Assert.Equal("urgente", s.Nivel);
        Assert.Contains("Fora AC marcou 4 golos seguidos", s.Detalhe);
        Assert.Contains("Restam 2 time-outs", s.Detalhe);
    }

    [Fact]
    public void Tres_golos_seguidos_ainda_nao_chegam()
    {
        var e = Jogo(900);
        e.Remates.AddRange(new[] { Golo(Casa, 100), Golo(Fora, 400), Golo(Fora, 500), Golo(Fora, 600) });
        Assert.Null(Com(Assistente.Calcular(e, SemTimeouts), "TIMEOUT"));
    }

    [Fact]
    public void Um_golo_da_equipa_que_sofre_interrompe_a_serie()
    {
        var e = Jogo(900);
        e.Remates.AddRange(new[] { Golo(Fora, 300), Golo(Fora, 400), Golo(Casa, 450), Golo(Fora, 500), Golo(Fora, 600) });
        Assert.Null(Com(Assistente.Calcular(e, SemTimeouts), "TIMEOUT"));
    }

    [Fact]
    public void Depois_de_a_equipa_pedir_time_out_a_serie_comeca_do_zero()
    {
        var e = Jogo(900);
        var golos = new[] { Golo(Fora, 300, 1), Golo(Fora, 400, 2), Golo(Fora, 500, 3), Golo(Fora, 600, 4) };
        e.Remates.AddRange(golos);
        var pedido = Timeout(Casa, 1, id: 5, segundo: 610);

        var a = Assistente.Calcular(e, new[] { pedido });
        Assert.Null(Com(a, "TIMEOUT"));
        Assert.Equal(1, a.Timeouts.First(t => t.EquipaId == Casa).Usados);

        // Mais quatro golos depois do time-out voltam a justificar outro
        e.Remates.AddRange(new[] { Golo(Fora, 700, 6), Golo(Fora, 710, 7), Golo(Fora, 720, 8), Golo(Fora, 730, 9) });
        var depois = Assistente.Calcular(e, new[] { pedido });
        Assert.Equal("urgente", Com(depois, "TIMEOUT", Casa)!.Nivel);
        Assert.Contains("Resta 1 time-out", Com(depois, "TIMEOUT", Casa)!.Detalhe);
    }

    [Fact]
    public void O_time_out_do_adversario_nao_apaga_a_serie_de_quem_sofre()
    {
        var e = Jogo(900);
        e.Remates.AddRange(new[] { Golo(Fora, 300, 1), Golo(Fora, 400, 2), Golo(Fora, 500, 3), Golo(Fora, 600, 4) });
        var a = Assistente.Calcular(e, new[] { Timeout(Fora, 1, id: 5) });
        Assert.NotNull(Com(a, "TIMEOUT", Casa));
    }

    [Fact]
    public void Um_parcial_pesado_nos_ultimos_minutos_sugere_time_out()
    {
        var e = Jogo(1000);
        e.Remates.AddRange(new[] { Golo(Fora, 740), Golo(Fora, 800), Golo(Casa, 820), Golo(Fora, 850), Golo(Fora, 900), Golo(Fora, 950) });
        var s = Com(Assistente.Calcular(e, SemTimeouts), "TIMEOUT", Casa);
        Assert.NotNull(s);
        Assert.Contains("arcial de 5–1 para Fora AC nos últimos 5 minutos", s!.Detalhe);
        Assert.DoesNotContain("seguidos", s.Detalhe);   // a série é só de 3: o motivo é o parcial
    }

    [Fact]
    public void Golos_fora_da_janela_do_parcial_nao_contam()
    {
        var e = Jogo(1000);   // a janela é (700, 1000]
        e.Remates.AddRange(new[] { Golo(Fora, 100), Golo(Fora, 200), Golo(Fora, 300), Golo(Casa, 800), Golo(Fora, 900) });
        Assert.Null(Com(Assistente.Calcular(e, SemTimeouts), "TIMEOUT"));
    }

    [Fact]
    public void Sem_relogio_nao_se_calcula_o_parcial()
    {
        // Todos os eventos a 00:00: não há como saber quais foram os últimos 5 minutos
        var e = Jogo(0, relogioUsado: false);
        e.Remates.AddRange(new[] { Golo(Fora, 0), Golo(Casa, 0), Golo(Fora, 0), Golo(Fora, 0), Golo(Fora, 0) });
        // Os golos seguidos continuam a contar pela ordem de registo: aqui são só 3
        Assert.Null(Com(Assistente.Calcular(e, SemTimeouts), "TIMEOUT"));
    }

    [Fact]
    public void Sem_relogio_a_serie_de_golos_seguidos_continua_a_valer()
    {
        var e = Jogo(0, relogioUsado: false);
        e.Remates.AddRange(new[] { Golo(Fora, 0), Golo(Fora, 0), Golo(Fora, 0), Golo(Fora, 0) });
        Assert.NotNull(Com(Assistente.Calcular(e, SemTimeouts), "TIMEOUT", Casa));
    }

    [Fact]
    public void Dois_time_outs_na_mesma_parte_esgotam_os_direitos_dessa_parte()
    {
        var t = new[] { Timeout(Casa, 1), Timeout(Casa, 1) };
        Assert.Equal(0, Assistente.TimeoutsDe(Casa, t, 1).Restantes);
        // Na 2.ª parte volta a poder pedir, mas só um: no jogo são 3
        var segunda = Assistente.TimeoutsDe(Casa, t, 2);
        Assert.Equal(2, segunda.Usados);
        Assert.Equal(0, segunda.NaParte);
        Assert.Equal(1, segunda.Restantes);
    }

    [Fact]
    public void Tres_time_outs_no_jogo_esgotam_tudo()
    {
        var t = new[] { Timeout(Casa, 1), Timeout(Casa, 2), Timeout(Casa, 2) };
        Assert.Equal(0, Assistente.TimeoutsDe(Casa, t, 2).Restantes);
        Assert.Equal(3, Assistente.TimeoutsDe(Casa, t, 2).Usados);
    }

    [Fact]
    public void Os_time_outs_de_uma_equipa_nao_contam_para_a_outra()
    {
        var t = new[] { Timeout(Casa, 1), Timeout(Casa, 1) };
        Assert.Equal(2, Assistente.TimeoutsDe(Fora, t, 1).Restantes);
    }

    [Fact]
    public void Sem_time_outs_a_sugestao_avisa_em_vez_de_mandar_pedir()
    {
        var e = Jogo(900);
        e.Remates.AddRange(new[] { Golo(Fora, 300, 10), Golo(Fora, 400, 11), Golo(Fora, 500, 12), Golo(Fora, 600, 13) });
        var antes = new[] { Timeout(Casa, 1, id: 1), Timeout(Casa, 1, id: 2) };
        var a = Assistente.Calcular(e, antes);

        var s = Com(a, "TIMEOUT", Casa);
        Assert.NotNull(s);
        Assert.Equal("atencao", s!.Nivel);
        Assert.Contains("sem time-outs", s.Titulo);
    }

    [Fact]
    public void Na_segunda_parte_o_relogio_e_o_ultimo_evento_decidem_em_que_parte_vamos()
    {
        Assert.Equal(1, Assistente.ParteAtual(Jogo(1799)));
        Assert.Equal(2, Assistente.ParteAtual(Jogo(1800)));

        var e = Jogo(0, relogioUsado: false);
        e.UltimosEventos.Add(new EventoResumo { Parte = 2 });
        Assert.Equal(2, Assistente.ParteAtual(e));
    }

    // ---------------------------------------------------------------- sanções

    [Fact]
    public void Quem_tem_dois_2_minutos_e_nao_foi_expulso_merece_um_aviso()
    {
        var e = Jogo();
        e.Sancoes.Add(new SancaoJogador { JogadorId = 7, EquipaId = Casa, Numero = 9, Nome = "Rui", DoisMinutos = 2 });
        var s = Com(Assistente.Calcular(e, SemTimeouts), "SANCAO");
        Assert.NotNull(s);
        Assert.Equal(Casa, s!.EquipaId);
        Assert.Contains("#9 Rui", s.Titulo);
        Assert.Equal("atencao", s.Nivel);
    }

    [Fact]
    public void Com_um_2_minutos_ou_ja_expulso_nao_ha_aviso()
    {
        var e = Jogo();
        e.Sancoes.Add(new SancaoJogador { JogadorId = 7, EquipaId = Casa, Numero = 9, Nome = "Rui", DoisMinutos = 1 });
        e.Sancoes.Add(new SancaoJogador { JogadorId = 8, EquipaId = Casa, Numero = 10, Nome = "Rafa", DoisMinutos = 3, Expulso = true });
        Assert.Null(Com(Assistente.Calcular(e, SemTimeouts), "SANCAO"));
    }

    // ---------------------------------------------------------------- jogadores

    [Fact]
    public void Jogador_em_chamas_e_um_problema_do_adversario()
    {
        var e = Jogo();
        e.Jogadores.Add(Jogador(Casa, 3, 11, remates: 5, golos: 4));
        var s = Com(Assistente.Calcular(e, SemTimeouts), "MARCAR_JOGADOR");
        Assert.NotNull(s);
        Assert.Equal(Fora, s!.EquipaId);                       // quem tem de marcar é a outra equipa
        Assert.Contains("#11 de Casa FC", s.Titulo);
        Assert.Contains("4 golos em 5 remates (80%)", s.Detalhe);
    }

    [Theory]
    [InlineData(3, 3)]   // poucos remates
    [InlineData(5, 2)]   // poucos golos
    [InlineData(5, 3)]   // 60%: abaixo do limiar
    public void Sem_remates_ou_golos_que_cheguem_nao_ha_jogador_em_chamas(long remates, long golos)
    {
        var e = Jogo();
        e.Jogadores.Add(Jogador(Casa, 3, 11, remates, golos));
        Assert.Null(Com(Assistente.Calcular(e, SemTimeouts), "MARCAR_JOGADOR"));
    }

    [Fact]
    public void Jogador_a_falhar_muito_e_para_rever_na_propria_equipa()
    {
        var e = Jogo();
        e.Jogadores.Add(Jogador(Fora, 4, 6, remates: 6, golos: 1));
        var s = Com(Assistente.Calcular(e, SemTimeouts), "REVER_JOGADOR");
        Assert.NotNull(s);
        Assert.Equal(Fora, s!.EquipaId);
        Assert.Contains("1 golo em 6 remates (17%)", s.Detalhe);
    }

    [Theory]
    [InlineData(4, 0)]   // poucos remates para concluir seja o que for
    [InlineData(6, 2)]   // 33%: ainda aceitável
    public void Sem_remates_que_cheguem_nao_ha_jogador_para_rever(long remates, long golos)
    {
        var e = Jogo();
        e.Jogadores.Add(Jogador(Casa, 3, 11, remates, golos));
        Assert.Null(Com(Assistente.Calcular(e, SemTimeouts), "REVER_JOGADOR"));
    }

    // ---------------------------------------------------------------- guarda-redes

    [Fact]
    public void Guarda_redes_com_poucas_defesas_e_para_a_propria_equipa_considerar_trocar()
    {
        var e = Jogo();
        e.GuardaRedes.Add(GuardaRedes(Casa, 1, defesas: 1, golosSofridos: 9));
        var s = Com(Assistente.Calcular(e, SemTimeouts), "GUARDA_REDES_FRACO");
        Assert.NotNull(s);
        Assert.Equal(Casa, s!.EquipaId);
        Assert.Contains("1 defesa em 10 remates à baliza (10%)", s.Detalhe);
    }

    [Fact]
    public void Guarda_redes_em_grande_forma_pede_variar_as_finalizacoes_do_adversario()
    {
        var e = Jogo();
        e.GuardaRedes.Add(GuardaRedes(Casa, 1, defesas: 6, golosSofridos: 6));
        var s = Com(Assistente.Calcular(e, SemTimeouts), "GUARDA_REDES_FORTE");
        Assert.NotNull(s);
        Assert.Equal(Fora, s!.EquipaId);
        Assert.Equal("info", s.Nivel);
    }

    [Fact]
    public void Com_poucos_remates_a_baliza_nao_se_julga_o_guarda_redes()
    {
        var e = Jogo();
        e.GuardaRedes.Add(GuardaRedes(Casa, 1, defesas: 0, golosSofridos: 7));
        e.GuardaRedes.Add(GuardaRedes(Fora, 2, defesas: 7, golosSofridos: 0));
        Assert.Empty(Assistente.Calcular(e, SemTimeouts).Sugestoes);
    }

    // ---------------------------------------------------------------- corredor

    [Fact]
    public void Corredor_por_onde_o_adversario_marca_quase_sempre_deve_ser_fechado()
    {
        var e = Jogo();
        e.PorCorredor.Add(new EstatZona { EquipaId = Fora, Zona = "PONTA_ESQ", Remates = 6, Golos = 5 });
        var s = Com(Assistente.Calcular(e, SemTimeouts), "FECHAR_CORREDOR");
        Assert.NotNull(s);
        Assert.Equal(Casa, s!.EquipaId);                       // quem fecha é a equipa que defende
        Assert.Contains("ponta esquerda", s.Titulo);
        Assert.Contains("Fora AC marcou 5 de 6", s.Detalhe);
    }

    [Theory]
    [InlineData(4, 4)]    // poucos remates
    [InlineData(8, 4)]    // 50%
    [InlineData(5, 3)]    // poucos golos
    public void Sem_remates_ou_golos_que_cheguem_nao_ha_corredor_a_fechar(long remates, long golos)
    {
        var e = Jogo();
        e.PorCorredor.Add(new EstatZona { EquipaId = Fora, Zona = "CENTRAL", Remates = remates, Golos = golos });
        Assert.Null(Com(Assistente.Calcular(e, SemTimeouts), "FECHAR_CORREDOR"));
    }

    // ---------------------------------------------------------------- situações numéricas

    private static void Eficacia(EstatisticasJogo e, int equipa, string situacao, int remates, int golos) =>
        e.Numerica.Eficacia.Add(new EficaciaNumerica { EquipaId = equipa, Situacao = situacao, Remates = remates, Golos = golos });

    [Fact]
    public void Superioridade_mal_aproveitada_e_um_aviso_para_a_propria_equipa()
    {
        var e = Jogo(900);
        Eficacia(e, Casa, Numerica.Superioridade, remates: 5, golos: 1);
        var s = Com(Assistente.Calcular(e, SemTimeouts), "SUPERIORIDADE_FRACA");
        Assert.NotNull(s);
        Assert.Equal(Casa, s!.EquipaId);
        Assert.Contains("1 golo em 5 remates com mais um jogador em campo (20%)", s.Detalhe);
    }

    [Fact]
    public void Superioridade_bem_aproveitada_ou_com_poucos_remates_nao_diz_nada()
    {
        var e = Jogo(900);
        Eficacia(e, Casa, Numerica.Superioridade, remates: 5, golos: 4);
        Eficacia(e, Fora, Numerica.Superioridade, remates: 3, golos: 0);
        Assert.Null(Com(Assistente.Calcular(e, SemTimeouts), "SUPERIORIDADE_FRACA"));
    }

    [Fact]
    public void Quando_o_adversario_marca_muito_em_superioridade_a_defesa_em_inferioridade_precisa_de_atencao()
    {
        var e = Jogo(900);
        Eficacia(e, Fora, Numerica.Superioridade, remates: 4, golos: 3);
        var s = Com(Assistente.Calcular(e, SemTimeouts), "INFERIORIDADE_FRACA");
        Assert.NotNull(s);
        Assert.Equal(Casa, s!.EquipaId);
        Assert.Contains("Fora AC marcou 3 de 4", s.Detalhe);
    }

    [Fact]
    public void Sete_seis_com_mais_golos_sofridos_do_que_marcados_sai_caro()
    {
        var e = Jogo(900);
        Eficacia(e, Casa, Numerica.SeteSeis, remates: 4, golos: 1);
        Eficacia(e, Fora, Numerica.BalizaVazia, remates: 3, golos: 3);
        var s = Com(Assistente.Calcular(e, SemTimeouts), "SETE_SEIS_CARO");
        Assert.NotNull(s);
        Assert.Equal(Casa, s!.EquipaId);
        Assert.Contains("1 golo marcado e 3 sofridos", s.Detalhe);
    }

    [Fact]
    public void Sete_seis_que_compensa_ou_com_poucos_lances_nao_diz_nada()
    {
        var e = Jogo(900);
        Eficacia(e, Casa, Numerica.SeteSeis, remates: 4, golos: 3);
        Eficacia(e, Fora, Numerica.BalizaVazia, remates: 2, golos: 1);
        Assert.Null(Com(Assistente.Calcular(e, SemTimeouts), "SETE_SEIS_CARO"));

        var poucos = Jogo(900);
        Eficacia(poucos, Fora, Numerica.BalizaVazia, remates: 2, golos: 2);
        Assert.Null(Com(Assistente.Calcular(poucos, SemTimeouts), "SETE_SEIS_CARO"));
    }

    [Fact]
    public void Sem_relogio_as_regras_numericas_ficam_caladas()
    {
        var e = Jogo(0, relogioUsado: false);
        Eficacia(e, Casa, Numerica.Superioridade, remates: 5, golos: 0);
        Eficacia(e, Fora, Numerica.Superioridade, remates: 5, golos: 5);
        Assert.Empty(Assistente.Calcular(e, SemTimeouts).Sugestoes);
    }

    // ---------------------------------------------------------------- perdas de bola

    [Fact]
    public void Muitas_perdas_de_bola_comparadas_com_o_adversario_pedem_cuidado_na_circulacao()
    {
        var e = Jogo();
        e.OutrosEventos.Add(new OutroEvento { EquipaId = Casa, Tipo = "PERDA_BOLA", Nome = "Perda de bola", Total = 9 });
        e.OutrosEventos.Add(new OutroEvento { EquipaId = Fora, Tipo = "PERDA_BOLA", Nome = "Perda de bola", Total = 4 });
        var s = Com(Assistente.Calcular(e, SemTimeouts), "PERDAS_DE_BOLA");
        Assert.NotNull(s);
        Assert.Equal(Casa, s!.EquipaId);
        Assert.Contains("9 perdas contra 4", s.Detalhe);
    }

    [Fact]
    public void Perdas_parecidas_nas_duas_equipas_nao_dizem_nada()
    {
        var e = Jogo();
        e.OutrosEventos.Add(new OutroEvento { EquipaId = Casa, Tipo = "PERDA_BOLA", Nome = "Perda de bola", Total = 9 });
        e.OutrosEventos.Add(new OutroEvento { EquipaId = Fora, Tipo = "PERDA_BOLA", Nome = "Perda de bola", Total = 7 });
        Assert.Null(Com(Assistente.Calcular(e, SemTimeouts), "PERDAS_DE_BOLA"));
    }

    // ---------------------------------------------------------------- ordem e limite

    private static EstatisticasJogo JogoCheioDeProblemas()
    {
        var e = Jogo(1000);
        e.Remates.AddRange(new[] { Golo(Fora, 600), Golo(Fora, 700), Golo(Fora, 800), Golo(Fora, 900) });          // time-out
        e.Sancoes.Add(new SancaoJogador { JogadorId = 7, EquipaId = Casa, Numero = 9, Nome = "Rui", DoisMinutos = 2 });   // sanção
        e.Jogadores.Add(Jogador(Fora, 3, 11, 5, 4));                                                              // quente
        e.Jogadores.Add(Jogador(Casa, 4, 6, 6, 1));                                                               // frio
        e.GuardaRedes.Add(GuardaRedes(Casa, 1, 1, 9));                                                            // GR fraco
        e.PorCorredor.Add(new EstatZona { EquipaId = Fora, Zona = "PONTA_DIR", Remates = 5, Golos = 4 });          // corredor
        Eficacia(e, Casa, Numerica.Superioridade, 5, 1);                                                          // superioridade
        e.OutrosEventos.Add(new OutroEvento { EquipaId = Casa, Tipo = "PERDA_BOLA", Total = 10 });                 // perdas
        return e;
    }

    [Fact]
    public void As_sugestoes_mais_importantes_vem_primeiro_e_nunca_passam_do_limite()
    {
        var a = Assistente.Calcular(JogoCheioDeProblemas(), SemTimeouts);
        Assert.Equal(Assistente.MaximoSugestoes, a.Sugestoes.Count);
        Assert.Equal("TIMEOUT", a.Sugestoes[0].Codigo);
        Assert.Equal("SANCAO", a.Sugestoes[1].Codigo);
        Assert.Equal("SUPERIORIDADE_FRACA", a.Sugestoes[2].Codigo);
        Assert.True(a.Sugestoes.Select(s => s.Prioridade).SequenceEqual(a.Sugestoes.Select(s => s.Prioridade).OrderByDescending(p => p)));
        // A de menor importância (perdas de bola) ficou de fora
        Assert.Null(Com(a, "PERDAS_DE_BOLA"));
    }

    [Fact]
    public void O_resultado_e_sempre_o_mesmo_para_os_mesmos_dados()
    {
        var a = Assistente.Calcular(JogoCheioDeProblemas(), SemTimeouts);
        var b = Assistente.Calcular(JogoCheioDeProblemas(), SemTimeouts);
        Assert.True(a.Sugestoes.Select(s => s.Id).SequenceEqual(b.Sugestoes.Select(s => s.Id)));
        Assert.Equal(a.Sugestoes.Count, a.Sugestoes.Select(s => s.Id).Distinct().Count());   // ids únicos
    }
}
