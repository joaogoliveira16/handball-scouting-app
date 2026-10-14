using System.Globalization;
using HandballScouting.Api;
using HandballScouting.Api.Excel;

namespace HandballScouting.Tests;

public class ExportadorExcelTests
{
    private const int Casa = 1;
    private const int Fora = 2;
    private static readonly DateTimeOffset Agora = new(2026, 10, 11, 21, 0, 0, TimeSpan.Zero);

    private static JogadorInfo J(int id, int equipa, int numero, string nome, string posicao, bool convocado) =>
        new() { Id = id, EquipaId = equipa, Numero = (short)numero, Nome = nome, Posicao = posicao, Convocado = convocado };

    private static EventoExport Remate(
        long id, int equipa, int numero, string nome, string posicao, string resultado,
        string corredor, string distancia, short parte, int segundo,
        int? grId = null, int? grEquipa = null, int? grNumero = null, string? grNome = null,
        decimal? balizaX = null, decimal? balizaY = null, string? zona = null) => new()
    {
        Id = id, EquipaId = equipa, EquipaNome = equipa == Casa ? "Águias do Norte" : "Leões do Sul",
        Tipo = "REMATE", TipoNome = "Remate", JogadorNumero = (short)numero, JogadorNome = nome, JogadorPosicao = posicao,
        Resultado = resultado, Situacao = "POSICIONAL", Corredor = corredor, Distancia = distancia,
        X = 50.5m, Y = 30m, Parte = parte, SegundoJogo = segundo,
        GuardaRedesId = grId, GuardaRedesEquipaId = grEquipa, GuardaRedesNumero = (short?)grNumero, GuardaRedesNome = grNome,
        BalizaX = balizaX, BalizaY = balizaY, BalizaZona = zona
    };

    /// <summary>
    /// Jogo de exemplo. Casa: PE #7 1/1, LE #9 2 remates (1 golo, 1 defesa). Fora: CE #6 1/1, LD #8 1 remate fora.
    /// O pivô #5 da casa não está convocado.
    /// </summary>
    private static DadosExportacao Amostra(bool comConvocatoria = true)
    {
        var jogo = new JogoDetalhe
        {
            Id = 2, DataHora = new DateTime(2026, 10, 11, 19, 30, 0, DateTimeKind.Utc), Local = "Pavilhão Municipal",
            CasaId = Casa, CasaNome = "Águias do Norte", ForaId = Fora, ForaNome = "Leões do Sul",
            Jogadores =
            {
                J(1, Casa, 1, "Rui Gomes", "GR", comConvocatoria), J(2, Casa, 7, "Tiago Alves", "PE", comConvocatoria),
                J(3, Casa, 9, "Pedro Lima", "LE", comConvocatoria), J(4, Casa, 5, "Nuno Reis", "PV", false),
                J(11, Fora, 12, "Hugo Dias", "GR", comConvocatoria), J(12, Fora, 8, "Davi Cruz", "LD", comConvocatoria),
                J(13, Fora, 6, "Ivo Pinto", "CE", comConvocatoria)
            }
        };

        var estatisticas = new EstatisticasJogo
        {
            JogoId = 2,
            ParcialMinutos = 5,
            Equipas =
            {
                new ResumoEquipa { EquipaId = Casa, Nome = "Águias do Norte", ECasa = true, Remates = 3, Golos = 2, Defesas = 1, Eficacia = 66.7m },
                new ResumoEquipa { EquipaId = Fora, Nome = "Leões do Sul", ECasa = false, Remates = 2, Golos = 1, Fora = 1, Eficacia = 50.0m }
            },
            Jogadores =
            {
                new EstatJogador { JogadorId = 3, EquipaId = Casa, Numero = 9, Nome = "Pedro Lima", Posicao = "LE", Remates = 2, Golos = 1, Eficacia = 50.0m },
                new EstatJogador { JogadorId = 2, EquipaId = Casa, Numero = 7, Nome = "Tiago Alves", Posicao = "PE", Remates = 1, Golos = 1, Eficacia = 100.0m },
                new EstatJogador { JogadorId = 12, EquipaId = Fora, Numero = 8, Nome = "Davi Cruz", Posicao = "LD", Remates = 1, Golos = 0, Eficacia = 0.0m },
                new EstatJogador { JogadorId = 13, EquipaId = Fora, Numero = 6, Nome = "Ivo Pinto", Posicao = "CE", Remates = 1, Golos = 1, Eficacia = 100.0m }
            },
            PorCorredor =
            {
                new EstatZona { EquipaId = Casa, Zona = "PONTA_ESQ", Remates = 1, Golos = 1, Eficacia = 100.0m },
                new EstatZona { EquipaId = Casa, Zona = "LATERAL_ESQ", Remates = 2, Golos = 1, Eficacia = 50.0m },
                new EstatZona { EquipaId = Fora, Zona = "CENTRAL", Remates = 2, Golos = 1, Eficacia = 50.0m }
            },
            PorDistancia =
            {
                new EstatZona { EquipaId = Casa, Zona = "LINHA_9M", Remates = 2, Golos = 1, Eficacia = 50.0m },
                new EstatZona { EquipaId = Casa, Zona = "ATE_6M", Remates = 1, Golos = 1, Eficacia = 100.0m }
            },
            PorParte =
            {
                new EstatParte { EquipaId = Casa, Parte = 1, Remates = 1, Golos = 1, Eficacia = 100.0m },
                new EstatParte { EquipaId = Casa, Parte = 2, Remates = 2, Golos = 1, Eficacia = 50.0m },
                new EstatParte { EquipaId = Fora, Parte = 2, Remates = 2, Golos = 1, Eficacia = 50.0m }
            },
            GuardaRedes =
            {
                new EstatGuardaRedes { JogadorId = 1, EquipaId = Casa, Numero = 1, Nome = "Rui Gomes", Defesas = 0, GolosSofridos = 1, RematesBaliza = 1, PercentagemDefesa = 0.0m },
                new EstatGuardaRedes { JogadorId = 11, EquipaId = Fora, Numero = 12, Nome = "Hugo Dias", Defesas = 1, GolosSofridos = 2, RematesBaliza = 3, PercentagemDefesa = 33.3m }
            },
            Parcial =
            {
                new ParcialEquipa { EquipaId = Casa, Nome = "Águias do Norte", Remates = 2, Golos = 1 },
                new ParcialEquipa { EquipaId = Fora, Nome = "Leões do Sul", Remates = 0, Golos = 0 }
            },
            OutrosEventos =
            {
                new OutroEvento { EquipaId = Fora, Tipo = "FALTA_OFENSIVA", Nome = "Falta ofensiva", Total = 1 }
            }
        };

        return new DadosExportacao
        {
            Jogo = jogo,
            Estatisticas = estatisticas,
            Tipos =
            {
                new TipoEvento { Codigo = "REMATE", Nome = "Remate", ERemate = true, Ordem = 1 },
                new TipoEvento { Codigo = "FALTA_OFENSIVA", Nome = "Falta ofensiva", ERemate = false, Ordem = 2 },
                new TipoEvento { Codigo = "PERDA_BOLA", Nome = "Perda de bola", ERemate = false, Ordem = 3 }
            },
            Eventos =
            {
                Remate(1, Casa, 7, "Tiago Alves", "PE", "GOLO", "PONTA_ESQ", "ATE_6M", 1, 120),
                Remate(2, Casa, 9, "Pedro Lima", "LE", "GOLO", "LATERAL_ESQ", "LINHA_9M", 2, 2300),
                Remate(3, Fora, 8, "Davi Cruz", "LD", "FORA", "CENTRAL", "MAIS_9M", 2, 2400),
                Remate(4, Casa, 9, "Pedro Lima", "LE", "DEFESA", "LATERAL_ESQ", "LINHA_9M", 2, 2500,
                    grId: 11, grEquipa: Fora, grNumero: 12, grNome: "Hugo Dias", balizaX: 20.5m, balizaY: 15m, zona: "ALTO_ESQ"),
                Remate(5, Fora, 6, "Ivo Pinto", "CE", "GOLO", "CENTRAL", "DE_6_A_9M", 2, 3725,
                    grId: 1, grEquipa: Casa, grNumero: 1, grNome: "Rui Gomes"),
                new EventoExport
                {
                    Id = 6, EquipaId = Fora, EquipaNome = "Leões do Sul", Tipo = "FALTA_OFENSIVA", TipoNome = "Falta ofensiva",
                    JogadorNumero = 6, JogadorNome = "Ivo Pinto", JogadorPosicao = "CE", Situacao = "POSICIONAL", Parte = 2, SegundoJogo = 3800
                }
            }
        };
    }

    private static byte[] Gerar(DadosExportacao dados, int? equipaId = null) =>
        ExportadorExcel.Gerar(dados, equipaId, TimeZoneInfo.Utc, Agora);

    // ------------------------- Estrutura -------------------------

    [Fact]
    public void O_livro_tem_as_folhas_esperadas_pela_ordem_certa()
    {
        Assert.Equal(
            new List<string>
            {
                "Resumo", "Jogadores", "Por posição", "Por corredor", "Por distância", "Por parte", "Guarda-redes",
                "Defesas na baliza", "Golos na baliza", "Outros eventos", "Eventos"
            },
            LeitorXlsx.NomesDasFolhas(Gerar(Amostra())));
    }

    [Fact]
    public void Jogo_sem_nenhum_evento_gera_um_ficheiro_valido()
    {
        var dados = Amostra();
        dados.Eventos.Clear();
        dados.Estatisticas.Jogadores.Clear();
        dados.Estatisticas.PorCorredor.Clear();
        dados.Estatisticas.PorDistancia.Clear();
        dados.Estatisticas.PorParte.Clear();
        dados.Estatisticas.GuardaRedes.Clear();
        dados.Estatisticas.OutrosEventos.Clear();

        var bytes = Gerar(dados);
        Assert.True(LeitorXlsx.Linhas(bytes, "Eventos").Count == 1, "só devia ter o cabeçalho");
        Assert.True(LeitorXlsx.Linhas(bytes, "Por posição").Count == 1, "só devia ter o cabeçalho");
    }

    // ------------------------- Resumo -------------------------

    [Fact]
    public void Resumo_mostra_o_resultado_a_data_e_o_ambito()
    {
        var linhas = LeitorXlsx.Linhas(Gerar(Amostra()), "Resumo");
        var texto = linhas.Select(l => string.Join("|", l)).ToList();

        Assert.Contains(texto, l => l == "Águias do Norte vs Leões do Sul");
        Assert.Contains(texto, l => l == "Resultado|2 – 1");
        Assert.Contains(texto, l => l == "Data|2026-10-11 19:30");
        Assert.Contains(texto, l => l == "Local|Pavilhão Municipal");
        Assert.Contains(texto, l => l == "Âmbito|Jogo completo");
        Assert.Contains(texto, l => l == "Exportado em|2026-10-11 21:00 (UTC)");
    }

    [Fact]
    public void Resumo_tem_uma_linha_por_equipa_com_o_parcial()
    {
        var linhas = LeitorXlsx.Linhas(Gerar(Amostra()), "Resumo");
        var cabecalho = linhas.Single(l => l.Length > 0 && l[0] == "Equipa");
        var casa = linhas.Single(l => l.Length > 0 && l[0] == "Águias do Norte");

        Assert.Contains(cabecalho, c => c == "Golos nos últimos 5 min");
        Assert.Equal("Casa", casa[1]);
        Assert.Equal("3", casa[2]);   // remates
        Assert.Equal("2", casa[3]);   // golos
        Assert.Equal("66.7", casa[8]); // eficácia
        Assert.Equal("1", casa[9]);   // golos no parcial
        Assert.Equal("2", casa[10]);  // remates no parcial
    }

    [Fact]
    public void A_data_e_convertida_para_o_fuso_horario()
    {
        TimeZoneInfo lisboa;
        try { lisboa = TimeZoneInfo.FindSystemTimeZoneById("Europe/Lisbon"); }
        catch (TimeZoneNotFoundException) { return; } // sistema sem dados de fusos

        var linhas = LeitorXlsx.Linhas(ExportadorExcel.Gerar(Amostra(), null, lisboa, Agora), "Resumo");
        // 11 de outubro de 2026 ainda é hora de verão em Portugal (UTC+1)
        Assert.Contains(linhas, l => l.Length > 1 && l[0] == "Data" && l[1] == "2026-10-11 20:30");
    }

    [Fact]
    public void Fuso_desconhecido_cai_para_utc()
    {
        Assert.Equal(TimeZoneInfo.Utc.Id, ExportadorExcel.ObterFuso("Marte/Olympus").Id);
    }

    // ------------------------- Jogadores e convocatória -------------------------

    [Fact]
    public void Jogadores_so_mostra_os_convocados_quando_ha_convocatoria()
    {
        var linhas = LeitorXlsx.Linhas(Gerar(Amostra()), "Jogadores");

        Assert.Equal(new[] { "Equipa", "Nº", "Nome", "Posição", "Convocado", "Remates", "Golos", "Eficácia (%)" }, linhas[0]);
        Assert.Equal(6, linhas.Count - 1);                         // 7 jogadores, menos o pivô não convocado
        Assert.DoesNotContain(linhas, l => l.Length > 2 && l[2] == "Nuno Reis");
        Assert.True(linhas.Skip(1).All(l => l[4] == "Sim"));
    }

    [Fact]
    public void Jogadores_sem_convocatoria_mostra_todos_com_traco()
    {
        var linhas = LeitorXlsx.Linhas(Gerar(Amostra(comConvocatoria: false)), "Jogadores");
        Assert.Equal(7, linhas.Count - 1);
        Assert.True(linhas.Skip(1).All(l => l[4] == "–"));
    }

    [Fact]
    public void Jogadores_sem_remates_aparecem_com_zeros_e_sem_eficacia()
    {
        var linhas = LeitorXlsx.Linhas(Gerar(Amostra()), "Jogadores");
        var guardaRedes = linhas.Single(l => l.Length > 2 && l[2] == "Rui Gomes");
        Assert.Equal("0", guardaRedes[5]);
        Assert.Equal("0", guardaRedes[6]);
        Assert.Equal("", guardaRedes[7]);
        Assert.Equal("Guarda-redes", guardaRedes[3]);
    }

    [Fact]
    public void Jogador_com_remates_nao_convocado_aparece_na_mesma()
    {
        var dados = Amostra();
        dados.Jogo.Jogadores.Single(j => j.Id == 4).Convocado = false;
        dados.Estatisticas.Jogadores.Add(new EstatJogador
        {
            JogadorId = 4, EquipaId = Casa, Numero = 5, Nome = "Nuno Reis", Posicao = "PV", Remates = 1, Golos = 0, Eficacia = 0.0m
        });

        var linhas = LeitorXlsx.Linhas(Gerar(dados), "Jogadores");
        var pivo = linhas.Single(l => l.Length > 2 && l[2] == "Nuno Reis");
        Assert.Equal("Não", pivo[4]);
    }

    // ------------------------- Tabelas de estatísticas -------------------------

    [Fact]
    public void Por_posicao_agrupa_os_remates_e_segue_a_ordem_das_posicoes()
    {
        var linhas = LeitorXlsx.Linhas(Gerar(Amostra()), "Por posição");

        Assert.Equal(new[] { "Equipa", "Posição", "Remates", "Golos", "Defesas", "Fora", "Poste", "Bloqueados", "Eficácia (%)" }, linhas[0]);
        Assert.Equal(
            new[]
            {
                "Águias do Norte|Ponta esquerda|1|1|0|0|0|0|100",
                "Águias do Norte|Lateral esquerdo|2|1|1|0|0|0|50",
                "Leões do Sul|Central|1|1|0|0|0|0|100",
                "Leões do Sul|Lateral direito|1|0|0|1|0|0|0"
            },
            linhas.Skip(1).Select(l => string.Join("|", l)).ToArray());
    }

    [Fact]
    public void Por_corredor_usa_rotulos_e_ordem_do_campo()
    {
        var linhas = LeitorXlsx.Linhas(Gerar(Amostra()), "Por corredor").Skip(1).Select(l => string.Join("|", l)).ToArray();
        Assert.Equal(
            new[]
            {
                "Águias do Norte|Ponta esquerda|1|1|100",
                "Águias do Norte|Lateral esquerdo|2|1|50",
                "Leões do Sul|Central|2|1|50"
            },
            linhas);
    }

    [Fact]
    public void Por_distancia_usa_rotulos_e_ordem_do_campo()
    {
        var linhas = LeitorXlsx.Linhas(Gerar(Amostra()), "Por distância").Skip(1).Select(l => string.Join("|", l)).ToArray();
        Assert.Equal(
            new[] { "Águias do Norte|Até 6 m|1|1|100", "Águias do Norte|Linha de 9 m (9–11 m)|2|1|50" },
            linhas);
    }

    [Fact]
    public void Por_parte_mostra_primeira_e_segunda_parte()
    {
        var linhas = LeitorXlsx.Linhas(Gerar(Amostra()), "Por parte").Skip(1).Select(l => string.Join("|", l)).ToArray();
        Assert.Equal(
            new[] { "Águias do Norte|1.ª parte|1|1|100", "Águias do Norte|2.ª parte|2|1|50", "Leões do Sul|2.ª parte|2|1|50" },
            linhas);
    }

    [Fact]
    public void Guarda_redes_mostra_defesas_e_percentagem()
    {
        var linhas = LeitorXlsx.Linhas(Gerar(Amostra()), "Guarda-redes").Skip(1).Select(l => string.Join("|", l)).ToArray();
        Assert.Equal(
            new[] { "Águias do Norte|1|Rui Gomes|0|1|1|0", "Leões do Sul|12|Hugo Dias|1|2|3|33.3" },
            linhas);
    }

    [Fact]
    public void Outros_eventos_inclui_todos_os_tipos_com_zeros()
    {
        var linhas = LeitorXlsx.Linhas(Gerar(Amostra()), "Outros eventos").Skip(1).Select(l => string.Join("|", l)).ToArray();
        Assert.Equal(
            new[]
            {
                "Águias do Norte|Falta ofensiva|0", "Águias do Norte|Perda de bola|0",
                "Leões do Sul|Falta ofensiva|1", "Leões do Sul|Perda de bola|0"
            },
            linhas);
    }

    [Fact]
    public void Eventos_tem_uma_linha_por_evento_com_rotulos_e_tempo()
    {
        var linhas = LeitorXlsx.Linhas(Gerar(Amostra()), "Eventos");
        Assert.Equal(7, linhas.Count); // cabeçalho + 6 eventos

        var golo = linhas[2]; // evento 2
        Assert.Equal("2", golo[0]);
        Assert.Equal("2", golo[1]);                       // parte
        Assert.Equal("38:20", golo[2]);                   // 2300 s
        Assert.Equal("Águias do Norte", golo[3]);
        Assert.Equal("Remate", golo[4]);
        Assert.Equal("9", golo[5]);
        Assert.Equal("Pedro Lima", golo[6]);
        Assert.Equal("Lateral esquerdo", golo[7]);
        Assert.Equal("Golo", golo[8]);
        Assert.Equal("Posicional", golo[9]);
        Assert.Equal("Lateral esquerdo", golo[10]);
        Assert.Equal("Linha de 9 m (9–11 m)", golo[11]);
        Assert.Equal("50.5", golo[12]);
        Assert.Equal("30", golo[13]);
        Assert.Equal("", golo[14]);                       // guarda-redes (este remate não tem)
        Assert.Equal("", golo[15]);                       // zona da baliza
    }

    [Fact]
    public void Eventos_mostra_o_guarda_redes_e_o_local_da_defesa_na_baliza()
    {
        var linhas = LeitorXlsx.Linhas(Gerar(Amostra()), "Eventos");
        Assert.Equal(
            new[] { "Guarda-redes", "Zona da baliza", "Baliza X (%)", "Baliza Y (%)" },
            linhas[0].Skip(14).ToArray());

        var defesa = linhas[4]; // evento 4
        Assert.Equal("Defesa", defesa[8]);
        Assert.Equal("#12 Hugo Dias", defesa[14]);
        Assert.Equal("Alto à esquerda", defesa[15]);
        Assert.Equal("20.5", defesa[16]);
        Assert.Equal("15", defesa[17]);
    }

    // ------------------------- Defesas na baliza -------------------------

    private static List<string[]> TabelaDefesas(byte[] ficheiro) =>
        LeitorXlsx.Linhas(ficheiro, "Defesas na baliza").Where(l => l.Length > 3).ToList();

    [Fact]
    public void Defesas_na_baliza_tem_uma_coluna_por_zona_na_ordem_da_baliza()
    {
        var cabecalho = TabelaDefesas(Gerar(Amostra()))[0];
        Assert.Equal(
            new[]
            {
                "Equipa", "Nº", "Nome",
                "Alto à esquerda", "Alto ao centro", "Alto à direita",
                "Meio à esquerda", "Meio ao centro", "Meio à direita",
                "Baixo à esquerda", "Baixo ao centro", "Baixo à direita",
                "Sem local", "Total de defesas"
            },
            cabecalho);
    }

    [Fact]
    public void Defesas_na_baliza_conta_as_defesas_de_cada_guarda_redes_por_zona()
    {
        var linhas = TabelaDefesas(Gerar(Amostra())).Skip(1).Select(l => string.Join("|", l)).ToArray();
        // só o Hugo Dias (Leões do Sul) defendeu; o Rui Gomes só sofreu golos e não aparece
        Assert.Equal(new[] { "Leões do Sul|12|Hugo Dias|1|0|0|0|0|0|0|0|0|0|1" }, linhas);
    }

    [Fact]
    public void Defesa_sem_local_conta_em_sem_local_e_defesa_sem_guarda_redes_fica_numa_linha_propria()
    {
        var dados = Amostra();
        // o Hugo defende mais duas: uma no meio e outra sem local
        dados.Eventos.Add(Remate(7, Casa, 7, "Tiago Alves", "PE", "DEFESA", "PONTA_ESQ", "ATE_6M", 2, 2600,
            grId: 11, grEquipa: Fora, grNumero: 12, grNome: "Hugo Dias", balizaX: 50m, balizaY: 50m, zona: "MEIO_CENTRO"));
        dados.Eventos.Add(Remate(8, Casa, 7, "Tiago Alves", "PE", "DEFESA", "PONTA_ESQ", "ATE_6M", 2, 2700,
            grId: 11, grEquipa: Fora, grNumero: 12, grNome: "Hugo Dias"));
        // uma defesa da equipa de fora sem guarda-redes registado: a equipa do guarda-redes é a da casa
        dados.Eventos.Add(Remate(9, Fora, 8, "Davi Cruz", "LD", "DEFESA", "CENTRAL", "MAIS_9M", 2, 2800));

        var linhas = TabelaDefesas(Gerar(dados)).Skip(1).Select(l => string.Join("|", l)).ToArray();
        Assert.Equal(
            new[]
            {
                "Águias do Norte||(sem guarda-redes)|0|0|0|0|0|0|0|0|0|1|1",
                "Leões do Sul|12|Hugo Dias|1|0|0|0|1|0|0|0|0|1|3"
            },
            linhas);
    }

    [Fact]
    public void Defesas_na_baliza_de_uma_equipa_so_mostra_os_guarda_redes_dessa_equipa()
    {
        var dados = Amostra();
        dados.Eventos.Add(Remate(7, Fora, 8, "Davi Cruz", "LD", "DEFESA", "CENTRAL", "MAIS_9M", 2, 2800,
            grId: 1, grEquipa: Casa, grNumero: 1, grNome: "Rui Gomes", balizaX: 90m, balizaY: 90m, zona: "BAIXO_DIR"));

        var casa = TabelaDefesas(Gerar(dados, equipaId: Casa)).Skip(1).Select(l => string.Join("|", l)).ToArray();
        Assert.Equal(new[] { "Águias do Norte|1|Rui Gomes|0|0|0|0|0|0|0|0|1|0|1" }, casa);

        var fora = TabelaDefesas(Gerar(dados, equipaId: Fora)).Skip(1).Select(l => string.Join("|", l)).ToArray();
        Assert.Equal(new[] { "Leões do Sul|12|Hugo Dias|1|0|0|0|0|0|0|0|0|0|1" }, fora);
    }

    [Fact]
    public void Defesas_na_baliza_explica_o_lado_na_nota_final()
    {
        var todas = LeitorXlsx.Linhas(Gerar(Amostra()), "Defesas na baliza");
        Assert.Contains(todas, l => l.Length == 1 && l[0].Contains("vistas de frente"));
    }

    // ------------------------- Golos na baliza -------------------------

    private static List<string[]> TabelaGolos(byte[] ficheiro) =>
        LeitorXlsx.Linhas(ficheiro, "Golos na baliza").Where(l => l.Length > 3).ToList();

    [Fact]
    public void Golos_na_baliza_tem_as_mesmas_colunas_das_defesas_e_o_total_de_golos()
    {
        var cabecalho = TabelaGolos(Gerar(Amostra()))[0];
        Assert.Equal(
            new[]
            {
                "Equipa", "Nº", "Nome",
                "Alto à esquerda", "Alto ao centro", "Alto à direita",
                "Meio à esquerda", "Meio ao centro", "Meio à direita",
                "Baixo à esquerda", "Baixo ao centro", "Baixo à direita",
                "Sem local", "Total de golos"
            },
            cabecalho);
    }

    [Fact]
    public void Golos_sem_local_contam_em_sem_local_e_os_com_local_na_zona_do_guarda_redes_que_os_sofreu()
    {
        var dados = Amostra();
        // o Rui Gomes (Águias) sofre mais dois golos: um no canto de baixo à direita e outro sem local
        dados.Eventos.Add(Remate(7, Fora, 6, "Ivo Pinto", "CE", "GOLO", "CENTRAL", "DE_6_A_9M", 2, 3900,
            grId: 1, grEquipa: Casa, grNumero: 1, grNome: "Rui Gomes", balizaX: 90m, balizaY: 90m, zona: "BAIXO_DIR"));
        dados.Eventos.Add(Remate(8, Fora, 8, "Davi Cruz", "LD", "GOLO", "CENTRAL", "MAIS_9M", 2, 3950,
            grId: 1, grEquipa: Casa, grNumero: 1, grNome: "Rui Gomes"));

        var linhas = TabelaGolos(Gerar(dados)).Skip(1).Select(l => string.Join("|", l)).ToArray();
        Assert.Equal(
            new[]
            {
                // Rui Gomes: o golo do Ivo (5) e o do Davi (8) sem local, e o do Ivo (7) em baixo à direita
                "Águias do Norte|1|Rui Gomes|0|0|0|0|0|0|0|0|1|2|3",
                // os dois golos das Águias não têm guarda-redes registado: ficam numa linha da equipa de fora
                "Leões do Sul||(sem guarda-redes)|0|0|0|0|0|0|0|0|0|2|2"
            },
            linhas);
    }

    [Fact]
    public void Golos_na_baliza_de_uma_equipa_so_mostra_os_guarda_redes_dessa_equipa()
    {
        var dados = Amostra();
        var fora = TabelaGolos(Gerar(dados, equipaId: Fora)).Skip(1).Select(l => string.Join("|", l)).ToArray();
        Assert.Equal(new[] { "Leões do Sul||(sem guarda-redes)|0|0|0|0|0|0|0|0|0|2|2" }, fora);
    }

    [Fact]
    public void Evento_sem_resultado_deixa_as_colunas_do_remate_vazias()
    {
        var falta = LeitorXlsx.Linhas(Gerar(Amostra()), "Eventos").Last();
        Assert.Equal("Falta ofensiva", falta[4]);
        Assert.Equal("", falta[8]);   // resultado
        Assert.Equal("", falta[12]);  // x
    }

    // ------------------------- Só uma equipa -------------------------

    [Fact]
    public void Exportar_uma_equipa_so_inclui_as_linhas_dessa_equipa()
    {
        var bytes = Gerar(Amostra(), equipaId: Fora);

        foreach (var folha in new[] { "Jogadores", "Por posição", "Por corredor", "Por parte", "Guarda-redes", "Outros eventos", "Eventos" })
        {
            var linhas = LeitorXlsx.Linhas(bytes, folha).Skip(1).ToList();
            Assert.NotEmpty(linhas);
            // a equipa está na 1.ª coluna (4.ª no caso dos eventos)
            var coluna = folha == "Eventos" ? 3 : 0;
            Assert.True(linhas.All(l => l[coluna] == "Leões do Sul"), $"a folha {folha} tem linhas de outra equipa");
        }
    }

    [Fact]
    public void Exportar_uma_equipa_indica_o_ambito_e_mantem_o_resultado_do_jogo()
    {
        var resumo = LeitorXlsx.Linhas(Gerar(Amostra(), equipaId: Casa), "Resumo").Select(l => string.Join("|", l)).ToList();
        Assert.Contains(resumo, l => l == "Âmbito|Equipa: Águias do Norte");
        Assert.Contains(resumo, l => l == "Resultado|2 – 1");
        Assert.DoesNotContain(resumo, l => l.StartsWith("Leões do Sul|"));
    }

    [Fact]
    public void Equipa_que_nao_joga_neste_jogo_e_rejeitada()
    {
        Assert.Throws<ArgumentException>(() => Gerar(Amostra(), equipaId: 99));
    }

    // ------------------------- Auxiliares -------------------------

    [Theory]
    [InlineData(1, 3, "33.3")]
    [InlineData(2, 3, "66.7")]
    [InlineData(1, 8, "12.5")]
    [InlineData(1, 16, "6.3")]  // 6,25 arredonda para cima, como o ROUND do PostgreSQL
    [InlineData(3, 3, "100")]
    [InlineData(0, 4, "0")]
    [InlineData(0, 0, "")]
    public void Eficacia_com_uma_casa_decimal(int golos, int remates, string esperado)
    {
        var valor = ExportadorExcel.Eficacia(golos, remates);
        Assert.Equal(esperado, valor is null ? "" : valor.Value.ToString("0.#", CultureInfo.InvariantCulture));
    }

    [Theory]
    [InlineData(0, "00:00")]
    [InlineData(125, "02:05")]
    [InlineData(1800, "30:00")]
    [InlineData(3725, "62:05")]
    [InlineData(-5, "00:00")]
    public void Formato_do_tempo_de_jogo(int segundos, string esperado)
    {
        Assert.Equal(esperado, ExportadorExcel.Tempo(segundos));
    }

    [Theory]
    [InlineData("Águias do Norte", "aguias-do-norte")]
    [InlineData("  Leões   do Sul!! ", "leoes-do-sul")]
    [InlineData("ABC 123", "abc-123")]
    [InlineData("???", "")]
    public void Slug_sem_acentos_nem_simbolos(string texto, string esperado)
    {
        Assert.Equal(esperado, ExportadorExcel.Slug(texto));
    }

    [Fact]
    public void Nome_do_ficheiro_do_jogo_e_da_equipa()
    {
        var jogo = Amostra().Jogo;
        Assert.Equal("estatisticas-aguias-do-norte-vs-leoes-do-sul.xlsx", ExportadorExcel.NomeFicheiro(jogo));
        Assert.Equal("estatisticas-leoes-do-sul-aguias-do-norte-vs-leoes-do-sul.xlsx", ExportadorExcel.NomeFicheiro(jogo, Fora));
    }
}
