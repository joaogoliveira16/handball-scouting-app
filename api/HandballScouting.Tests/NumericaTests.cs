using HandballScouting.Api;

namespace HandballScouting.Tests;

public class NumericaTests
{
    private const int Casa = 1, Fora = 2;

    private static long _proximoId = 1;

    private static SuspensaoJogo DoisMinutos(int equipa, int segundo, string tipo = "DOIS_MINUTOS") =>
        new() { EventoId = _proximoId++, EquipaId = equipa, JogadorId = 10, JogadorNumero = 7, Tipo = tipo, SegundoJogo = segundo };

    private static SeteSeisEvento SeteSeis(int equipa, int segundo, bool inicio, long? id = null) =>
        new() { EventoId = id ?? _proximoId++, EquipaId = equipa, Tipo = inicio ? "SETE_SEIS_INICIO" : "SETE_SEIS_FIM", SegundoJogo = segundo };

    private static RemateMapa Remate(int equipa, int segundo, string resultado = "GOLO", string situacao = "POSICIONAL", long? id = null) =>
        new() { Id = id ?? _proximoId++, EquipaId = equipa, SegundoJogo = segundo, Resultado = resultado, Situacao = situacao };

    private static readonly IReadOnlyList<SeteSeisEvento> SemSeteSeis = new List<SeteSeisEvento>();
    private static readonly IReadOnlyList<SuspensaoJogo> SemSuspensoes = new List<SuspensaoJogo>();

    // ---------------------------------------------------------------- jogadores a menos

    [Fact]
    public void Dois_minutos_deixam_a_equipa_com_menos_um_jogador_durante_120_segundos()
    {
        var s = new[] { DoisMinutos(Casa, 600) };
        Assert.Equal(0, Numerica.JogadoresAMenos(s, Casa, 599));
        Assert.Equal(1, Numerica.JogadoresAMenos(s, Casa, 600));
        Assert.Equal(1, Numerica.JogadoresAMenos(s, Casa, 719));
        Assert.Equal(0, Numerica.JogadoresAMenos(s, Casa, 720));
    }

    [Fact]
    public void A_sancao_so_conta_para_a_equipa_do_jogador()
    {
        var s = new[] { DoisMinutos(Casa, 600) };
        Assert.Equal(0, Numerica.JogadoresAMenos(s, Fora, 650));
    }

    [Fact]
    public void O_vermelho_direto_tambem_deixa_a_equipa_dois_minutos_com_menos_um_jogador()
    {
        var s = new[] { DoisMinutos(Casa, 600, "VERMELHO") };
        Assert.Equal(1, Numerica.JogadoresAMenos(s, Casa, 650));
        Assert.Equal(0, Numerica.JogadoresAMenos(s, Casa, 720));
    }

    [Fact]
    public void Dois_minutos_sobrepostos_somam_mas_nunca_mais_de_dois_a_menos()
    {
        var s = new[] { DoisMinutos(Casa, 600), DoisMinutos(Casa, 660), DoisMinutos(Casa, 670) };
        Assert.Equal(1, Numerica.JogadoresAMenos(s, Casa, 620));
        Assert.Equal(2, Numerica.JogadoresAMenos(s, Casa, 665));
        Assert.Equal(2, Numerica.JogadoresAMenos(s, Casa, 680));   // três ativos: em campo ficam sempre 4
        Assert.Equal(2, Numerica.JogadoresAMenos(s, Casa, 725));   // o primeiro já acabou, os outros dois ainda não
        Assert.Equal(0, Numerica.JogadoresAMenos(s, Casa, 790));
    }

    // ---------------------------------------------------------------- situação de cada remate

    [Fact]
    public void Sem_sancoes_nem_7x6_e_igualdade()
    {
        Assert.Equal(Numerica.Igualdade, Numerica.Situacao(SemSuspensoes, SemSeteSeis, Casa, Fora, 300));
    }

    [Fact]
    public void Quem_tem_o_adversario_em_inferioridade_remata_em_superioridade()
    {
        var s = new[] { DoisMinutos(Fora, 600) };
        Assert.Equal(Numerica.Superioridade, Numerica.Situacao(s, SemSeteSeis, Casa, Fora, 650));
        Assert.Equal(Numerica.Inferioridade, Numerica.Situacao(s, SemSeteSeis, Fora, Casa, 650));
    }

    [Fact]
    public void Sancoes_em_ambas_as_equipas_ao_mesmo_tempo_e_igualdade()
    {
        var s = new[] { DoisMinutos(Casa, 600), DoisMinutos(Fora, 610) };
        Assert.Equal(Numerica.Igualdade, Numerica.Situacao(s, SemSeteSeis, Casa, Fora, 650));
        Assert.Equal(Numerica.Igualdade, Numerica.Situacao(s, SemSeteSeis, Fora, Casa, 650));
    }

    [Fact]
    public void Duas_sancoes_contra_uma_continua_a_ser_inferioridade_para_quem_tem_mais()
    {
        var s = new[] { DoisMinutos(Casa, 600), DoisMinutos(Casa, 620), DoisMinutos(Fora, 630) };
        Assert.Equal(Numerica.Inferioridade, Numerica.Situacao(s, SemSeteSeis, Casa, Fora, 640));
        Assert.Equal(Numerica.Superioridade, Numerica.Situacao(s, SemSeteSeis, Fora, Casa, 640));
    }

    [Fact]
    public void Em_7x6_a_equipa_remata_em_sete_seis_e_o_adversario_contra_a_baliza_vazia()
    {
        var t = new[] { SeteSeis(Casa, 1000, inicio: true), SeteSeis(Casa, 1100, inicio: false) };
        Assert.Equal(Numerica.SeteSeis, Numerica.Situacao(SemSuspensoes, t, Casa, Fora, 1050));
        Assert.Equal(Numerica.BalizaVazia, Numerica.Situacao(SemSuspensoes, t, Fora, Casa, 1050));
        Assert.Equal(Numerica.Igualdade, Numerica.Situacao(SemSuspensoes, t, Casa, Fora, 1101));
        Assert.Equal(Numerica.Igualdade, Numerica.Situacao(SemSuspensoes, t, Casa, Fora, 999));
    }

    [Fact]
    public void O_7x6_tem_prioridade_sobre_a_superioridade()
    {
        var s = new[] { DoisMinutos(Fora, 600) };
        var t = new[] { SeteSeis(Casa, 610, inicio: true) };
        Assert.Equal(Numerica.SeteSeis, Numerica.Situacao(s, t, Casa, Fora, 650));
    }

    [Fact]
    public void No_mesmo_segundo_do_fim_do_7x6_decide_a_ordem_do_registo()
    {
        var inicio = SeteSeis(Casa, 1000, inicio: true, id: 10);
        var fim = SeteSeis(Casa, 1100, inicio: false, id: 20);
        var t = new[] { inicio, fim };
        Assert.Equal(Numerica.SeteSeis, Numerica.Situacao(SemSuspensoes, t, Casa, Fora, 1100, eventoId: 15));
        Assert.Equal(Numerica.Igualdade, Numerica.Situacao(SemSuspensoes, t, Casa, Fora, 1100, eventoId: 25));
    }

    [Fact]
    public void Um_fim_sem_inicio_nao_liga_o_7x6_e_dois_inicios_seguidos_continuam_ligados()
    {
        Assert.False(Numerica.SeteSeisAtivo(new[] { SeteSeis(Casa, 500, inicio: false) }, Casa, 600));
        Assert.True(Numerica.SeteSeisAtivo(new[] { SeteSeis(Casa, 500, inicio: true), SeteSeis(Casa, 520, inicio: true) }, Casa, 600));
    }

    // ---------------------------------------------------------------- cálculo completo

    [Fact]
    public void Sem_relogio_nao_ha_eficacia_nem_tempo()
    {
        var r = Numerica.Calcular(Casa, Fora, new[] { DoisMinutos(Fora, 0) }, SemSeteSeis, new[] { Remate(Casa, 0) }, agora: 0, relogioUsado: false);
        Assert.False(r.RelogioUsado);
        Assert.Empty(r.Eficacia);
        Assert.Empty(r.Tempo);
        Assert.Single(r.Suspensoes);
    }

    [Fact]
    public void A_eficacia_separa_os_remates_por_situacao_e_equipa()
    {
        var suspensoes = new[] { DoisMinutos(Fora, 600) };
        var remates = new[]
        {
            Remate(Casa, 300, "GOLO"),                 // igualdade
            Remate(Casa, 400, "DEFESA"),               // igualdade
            Remate(Casa, 610, "GOLO"),                 // superioridade
            Remate(Casa, 650, "GOLO"),                 // superioridade
            Remate(Casa, 700, "FORA"),                 // superioridade
            Remate(Fora, 620, "DEFESA"),               // inferioridade
            Remate(Fora, 900, "GOLO"),                 // igualdade
        };
        var r = Numerica.Calcular(Casa, Fora, suspensoes, SemSeteSeis, remates, agora: 1000, relogioUsado: true);

        EficaciaNumerica Linha(int equipa, string situacao) => r.Eficacia.Single(x => x.EquipaId == equipa && x.Situacao == situacao);
        Assert.Equal((3, 2), (Linha(Casa, Numerica.Superioridade).Remates, Linha(Casa, Numerica.Superioridade).Golos));
        Assert.Equal((2, 1), (Linha(Casa, Numerica.Igualdade).Remates, Linha(Casa, Numerica.Igualdade).Golos));
        Assert.Equal((1, 0), (Linha(Fora, Numerica.Inferioridade).Remates, Linha(Fora, Numerica.Inferioridade).Golos));
        Assert.Equal((1, 1), (Linha(Fora, Numerica.Igualdade).Remates, Linha(Fora, Numerica.Igualdade).Golos));
        Assert.Equal(4, r.Eficacia.Count);
    }

    [Fact]
    public void Os_7_metros_ficam_fora_das_contas()
    {
        var suspensoes = new[] { DoisMinutos(Fora, 600) };
        var remates = new[] { Remate(Casa, 610, "GOLO", situacao: "SETE_METROS"), Remate(Casa, 620, "GOLO") };
        var r = Numerica.Calcular(Casa, Fora, suspensoes, SemSeteSeis, remates, agora: 1000, relogioUsado: true);
        var linha = Assert.Single(r.Eficacia);
        Assert.Equal((Numerica.Superioridade, 1), (linha.Situacao, linha.Remates));
    }

    [Fact]
    public void Os_remates_contra_a_baliza_vazia_contam_para_quem_remata()
    {
        var t = new[] { SeteSeis(Casa, 1000, inicio: true) };
        var remates = new[] { Remate(Fora, 1020, "GOLO"), Remate(Casa, 1030, "DEFESA") };
        var r = Numerica.Calcular(Casa, Fora, SemSuspensoes, t, remates, agora: 1100, relogioUsado: true);
        Assert.Contains(r.Eficacia, x => x.EquipaId == Fora && x.Situacao == Numerica.BalizaVazia && x.Golos == 1);
        Assert.Contains(r.Eficacia, x => x.EquipaId == Casa && x.Situacao == Numerica.SeteSeis && x.Remates == 1 && x.Golos == 0);
    }

    [Fact]
    public void O_tempo_em_superioridade_soma_os_periodos_certos()
    {
        // Casa: 600-720. Fora: 660-780. Entre 660 e 720 há uma a menos de cada lado: igualdade.
        var s = new[] { DoisMinutos(Casa, 600), DoisMinutos(Fora, 660) };
        var r = Numerica.Calcular(Casa, Fora, s, SemSeteSeis, Array.Empty<RemateMapa>(), agora: 900, relogioUsado: true);

        int Segundos(int equipa, string situacao) => r.Tempo.SingleOrDefault(t => t.EquipaId == equipa && t.Situacao == situacao)?.Segundos ?? 0;
        Assert.Equal(60, Segundos(Casa, Numerica.Inferioridade));
        Assert.Equal(60, Segundos(Fora, Numerica.Superioridade));
        Assert.Equal(60, Segundos(Casa, Numerica.Superioridade));
        Assert.Equal(60, Segundos(Fora, Numerica.Inferioridade));
    }

    [Fact]
    public void O_tempo_so_conta_ate_ao_segundo_atual()
    {
        var s = new[] { DoisMinutos(Fora, 600) };
        var r = Numerica.Calcular(Casa, Fora, s, SemSeteSeis, Array.Empty<RemateMapa>(), agora: 650, relogioUsado: true);
        Assert.Equal(50, r.Tempo.Single(t => t.EquipaId == Casa && t.Situacao == Numerica.Superioridade).Segundos);
        Assert.Equal(50, r.Tempo.Single(t => t.EquipaId == Fora && t.Situacao == Numerica.Inferioridade).Segundos);
    }

    [Fact]
    public void Duas_sancoes_seguidas_na_mesma_equipa_somam_o_tempo_das_duas()
    {
        var s = new[] { DoisMinutos(Casa, 100), DoisMinutos(Casa, 400) };
        var r = Numerica.Calcular(Casa, Fora, s, SemSeteSeis, Array.Empty<RemateMapa>(), agora: 1000, relogioUsado: true);
        Assert.Equal(240, r.Tempo.Single(t => t.EquipaId == Fora && t.Situacao == Numerica.Superioridade).Segundos);
    }

    [Fact]
    public void O_tempo_em_7x6_conta_ate_ao_fim_ou_ate_agora_se_ainda_esta_ligado()
    {
        var t = new[]
        {
            SeteSeis(Casa, 1000, inicio: true), SeteSeis(Casa, 1090, inicio: false),   // 90 s
            SeteSeis(Casa, 1500, inicio: true),                                        // aberto: até agora (1560)
        };
        var r = Numerica.Calcular(Casa, Fora, SemSuspensoes, t, Array.Empty<RemateMapa>(), agora: 1560, relogioUsado: true);
        Assert.Equal(150, r.Tempo.Single(x => x.EquipaId == Casa && x.Situacao == Numerica.SeteSeis).Segundos);
        Assert.DoesNotContain(r.Tempo, x => x.EquipaId == Fora);
    }

    [Fact]
    public void O_estado_do_7x6_vale_o_ultimo_evento_registado()
    {
        var t = new[] { SeteSeis(Casa, 1000, inicio: true, id: 1), SeteSeis(Casa, 1090, inicio: false, id: 2), SeteSeis(Casa, 1500, inicio: true, id: 3) };
        var casa = Numerica.EstadoSeteSeis(t, Casa);
        Assert.True(casa.Ativo);
        Assert.Equal(1500, casa.Desde);
        var fora = Numerica.EstadoSeteSeis(t, Fora);
        Assert.False(fora.Ativo);
        Assert.Null(fora.Desde);
        // desfazer o último evento volta ao estado anterior
        Assert.False(Numerica.EstadoSeteSeis(t.Take(2).ToList(), Casa).Ativo);
    }
}
