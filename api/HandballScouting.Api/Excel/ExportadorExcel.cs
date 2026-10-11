using System.Globalization;
using System.Text;

namespace HandballScouting.Api.Excel;

/// <summary>Constrói o livro Excel com as estatísticas de um jogo (ou de uma só equipa do jogo).</summary>
public static class ExportadorExcel
{
    public const string TipoMime = LivroXlsx.TipoMime;
    public const string FusoPorDefeito = "Europe/Lisbon";

    private static readonly Dictionary<string, string> RotuloPosicao = new()
    {
        ["GR"] = "Guarda-redes", ["PE"] = "Ponta esquerda", ["LE"] = "Lateral esquerdo", ["CE"] = "Central",
        ["LD"] = "Lateral direito", ["PD"] = "Ponta direita", ["PV"] = "Pivô"
    };

    private static readonly Dictionary<string, string> RotuloCorredor = new()
    {
        ["PONTA_ESQ"] = "Ponta esquerda", ["LATERAL_ESQ"] = "Lateral esquerdo", ["CENTRAL"] = "Central",
        ["LATERAL_DIR"] = "Lateral direito", ["PONTA_DIR"] = "Ponta direita"
    };

    private static readonly Dictionary<string, string> RotuloDistancia = new()
    {
        ["ATE_6M"] = "Até 6 m", ["DE_6_A_9M"] = "6 a 9 m", ["LINHA_9M"] = "Linha de 9 m (9–11 m)", ["MAIS_9M"] = "Mais de 11 m"
    };

    private static readonly List<string> OrdemCorredor = new() { "PONTA_ESQ", "LATERAL_ESQ", "CENTRAL", "LATERAL_DIR", "PONTA_DIR" };
    private static readonly List<string> OrdemDistancia = new() { "ATE_6M", "DE_6_A_9M", "LINHA_9M", "MAIS_9M" };

    private static readonly Dictionary<string, string> RotuloResultado = new()
    {
        ["GOLO"] = "Golo", ["DEFESA"] = "Defesa", ["FORA"] = "Fora", ["POSTE"] = "Poste", ["BLOQUEADO"] = "Bloqueado"
    };

    private static readonly Dictionary<string, string> RotuloSituacao = new()
    {
        ["POSICIONAL"] = "Posicional", ["CONTRA_ATAQUE"] = "Contra-ataque", ["SETE_METROS"] = "7 metros"
    };

    // ------------------------- Pontos de entrada -------------------------

    /// <summary>Fuso horário configurado (identificador IANA) ou UTC se não existir no sistema.</summary>
    public static TimeZoneInfo ObterFuso(string? id)
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(string.IsNullOrWhiteSpace(id) ? FusoPorDefeito : id.Trim());
        }
        catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return TimeZoneInfo.Utc;
        }
    }

    /// <summary>Ex.: estatisticas-aguias-do-norte-vs-leoes-do-sul.xlsx (ou com o nome da equipa, se for só uma).</summary>
    public static string NomeFicheiro(JogoDetalhe jogo, int? equipaId = null)
    {
        var partes = new List<string> { "estatisticas" };
        if (equipaId is { } id)
            partes.Add(Slug(id == jogo.CasaId ? jogo.CasaNome : jogo.ForaNome));
        partes.Add(Slug(jogo.CasaNome));
        partes.Add("vs");
        partes.Add(Slug(jogo.ForaNome));
        return string.Join("-", partes.Where(p => p.Length > 0)) + ".xlsx";
    }

    /// <summary>
    /// Gera o ficheiro. Com <paramref name="equipaId"/> só entram as linhas dessa equipa
    /// (o resultado do jogo continua a mostrar as duas). <paramref name="agora"/> existe para os testes.
    /// </summary>
    public static byte[] Gerar(DadosExportacao dados, int? equipaId, TimeZoneInfo fuso, DateTimeOffset? agora = null)
    {
        var jogo = dados.Jogo;
        if (equipaId is { } id && id != jogo.CasaId && id != jogo.ForaId)
            throw new ArgumentException("A equipa não participa neste jogo.", nameof(equipaId));

        var contexto = new Contexto(dados, equipaId, fuso, agora ?? DateTimeOffset.UtcNow);

        return LivroXlsx.Gerar(new List<FolhaXlsx>
        {
            FolhaResumo(contexto),
            FolhaJogadores(contexto),
            FolhaPorPosicao(contexto),
            FolhaPorCorredor(contexto),
            FolhaPorDistancia(contexto),
            FolhaPorParte(contexto),
            FolhaGuardaRedes(contexto),
            FolhaOutrosEventos(contexto),
            FolhaEventos(contexto)
        });
    }

    // ------------------------- Contexto -------------------------

    private sealed class Contexto
    {
        public Contexto(DadosExportacao dados, int? equipaId, TimeZoneInfo fuso, DateTimeOffset agora)
        {
            Dados = dados;
            EquipaId = equipaId;
            Fuso = fuso;
            Agora = agora;
            Equipas = new (int Id, string Nome)[] { (dados.Jogo.CasaId, dados.Jogo.CasaNome), (dados.Jogo.ForaId, dados.Jogo.ForaNome) };
            EquipasIncluidas = Equipas.Where(e => equipaId is null || e.Id == equipaId).ToList();
            TiposRemate = dados.Tipos.Where(t => t.ERemate).Select(t => t.Codigo).ToHashSet();
        }

        public DadosExportacao Dados { get; }
        public JogoDetalhe Jogo => Dados.Jogo;
        public EstatisticasJogo Estat => Dados.Estatisticas;
        public int? EquipaId { get; }
        public TimeZoneInfo Fuso { get; }
        public DateTimeOffset Agora { get; }
        public (int Id, string Nome)[] Equipas { get; }
        public List<(int Id, string Nome)> EquipasIncluidas { get; }
        public HashSet<string> TiposRemate { get; }

        public bool Inclui(int equipaId) => EquipaId is null || EquipaId == equipaId;

        /// <summary>0 = equipa da casa, 1 = equipa de fora (para ordenar as linhas).</summary>
        public int OrdemEquipa(int equipaId) => equipaId == Jogo.CasaId ? 0 : 1;

        public string NomeEquipa(int equipaId) =>
            equipaId == Jogo.CasaId ? Jogo.CasaNome : equipaId == Jogo.ForaId ? Jogo.ForaNome : $"Equipa {equipaId}";

        /// <summary>Eventos que são remates com resultado (os que contam para as estatísticas de remate).</summary>
        public IEnumerable<EventoExport> Remates =>
            Dados.Eventos.Where(e => TiposRemate.Contains(e.Tipo) && e.Resultado is not null && Inclui(e.EquipaId));
    }

    // ------------------------- Folhas -------------------------

    private static FolhaXlsx FolhaResumo(Contexto c)
    {
        var folha = new FolhaXlsx("Resumo");
        var jogo = c.Jogo;
        var casa = c.Estat.Equipas.FirstOrDefault(e => e.EquipaId == jogo.CasaId);
        var fora = c.Estat.Equipas.FirstOrDefault(e => e.EquipaId == jogo.ForaId);

        folha.Adicionar(Celula.Titulo("Estatísticas do jogo"));
        folha.Adicionar(Celula.Negrito($"{jogo.CasaNome} vs {jogo.ForaNome}"));
        folha.LinhaVazia();

        folha.Adicionar(Celula.Negrito("Resultado"), Celula.Texto($"{casa?.Golos ?? 0} – {fora?.Golos ?? 0}"));
        folha.Adicionar(Celula.Negrito("Data"), Celula.Texto(DataLocal(jogo.DataHora, c.Fuso)));
        folha.Adicionar(Celula.Negrito("Local"), Celula.Texto(string.IsNullOrWhiteSpace(jogo.Local) ? "–" : jogo.Local));
        folha.Adicionar(Celula.Negrito("Âmbito"), Celula.Texto(
            c.EquipaId is null ? "Jogo completo" : $"Equipa: {c.NomeEquipa(c.EquipaId.Value)}"));
        folha.Adicionar(Celula.Negrito("Exportado em"), Celula.Texto(
            $"{DataLocal(c.Agora.UtcDateTime, c.Fuso)} ({c.Fuso.Id})"));
        folha.LinhaVazia();

        var minutos = c.Estat.ParcialMinutos;
        folha.Adicionar(
            Celula.Cabecalho("Equipa"), Celula.Cabecalho("Casa/Fora"), Celula.Cabecalho("Remates"), Celula.Cabecalho("Golos"),
            Celula.Cabecalho("Defesas"), Celula.Cabecalho("Fora"), Celula.Cabecalho("Poste"), Celula.Cabecalho("Bloqueados"),
            Celula.Cabecalho("Eficácia (%)"), Celula.Cabecalho($"Golos nos últimos {minutos} min"),
            Celula.Cabecalho($"Remates nos últimos {minutos} min"));

        foreach (var equipa in c.Estat.Equipas.Where(e => c.Inclui(e.EquipaId)))
        {
            var parcial = c.Estat.Parcial.FirstOrDefault(p => p.EquipaId == equipa.EquipaId);
            folha.Adicionar(
                Celula.Texto(equipa.Nome), Celula.Texto(equipa.ECasa ? "Casa" : "Fora"),
                Celula.Numero(equipa.Remates), Celula.Numero(equipa.Golos), Celula.Numero(equipa.Defesas),
                Celula.Numero(equipa.Fora), Celula.Numero(equipa.Poste), Celula.Numero(equipa.Bloqueados),
                Celula.Numero(equipa.Eficacia),
                Celula.Numero(parcial?.Golos ?? 0), Celula.Numero(parcial?.Remates ?? 0));
        }
        return folha;
    }

    private static FolhaXlsx FolhaJogadores(Contexto c)
    {
        var folha = Tabela("Jogadores", "Equipa", "Nº", "Nome", "Posição", "Convocado", "Remates", "Golos", "Eficácia (%)");
        folha.FiltroNoCabecalho = true;

        foreach (var (equipaId, nomeEquipa) in c.EquipasIncluidas)
        {
            var plantel = c.Jogo.Jogadores.Where(j => j.EquipaId == equipaId).OrderBy(j => j.Numero).ToList();
            var temConvocatoria = plantel.Any(j => j.Convocado);
            var estatisticas = c.Estat.Jogadores.Where(j => j.EquipaId == equipaId).ToDictionary(j => j.JogadorId);

            foreach (var jogador in plantel)
            {
                estatisticas.TryGetValue(jogador.Id, out var est);
                // Sem convocatória aparecem todos; com convocatória só os convocados (e quem rematou, por segurança)
                if (temConvocatoria && !jogador.Convocado && est is null) continue;

                folha.Adicionar(
                    Celula.Texto(nomeEquipa), Celula.Numero(jogador.Numero), Celula.Texto(jogador.Nome),
                    Celula.Texto(Rotulo(RotuloPosicao, jogador.Posicao)),
                    Celula.Texto(!temConvocatoria ? "–" : jogador.Convocado ? "Sim" : "Não"),
                    Celula.Numero(est?.Remates ?? 0), Celula.Numero(est?.Golos ?? 0), Celula.Numero(est?.Eficacia));
            }
        }
        return folha;
    }

    private static FolhaXlsx FolhaPorPosicao(Contexto c)
    {
        var folha = Tabela("Por posição", "Equipa", "Posição", "Remates", "Golos", "Defesas", "Fora", "Poste", "Bloqueados", "Eficácia (%)");
        var ordem = CadastroValidador.Posicoes.ToList();

        var grupos = c.Remates
            .Where(e => e.JogadorPosicao is not null)
            .GroupBy(e => (e.EquipaId, Posicao: e.JogadorPosicao!))
            .OrderBy(g => c.OrdemEquipa(g.Key.EquipaId))
            .ThenBy(g => Indice(ordem, g.Key.Posicao));

        foreach (var grupo in grupos)
        {
            var remates = grupo.ToList();
            folha.Adicionar(
                Celula.Texto(c.NomeEquipa(grupo.Key.EquipaId)), Celula.Texto(Rotulo(RotuloPosicao, grupo.Key.Posicao)),
                Celula.Numero(remates.Count), Celula.Numero(Contar(remates, "GOLO")), Celula.Numero(Contar(remates, "DEFESA")),
                Celula.Numero(Contar(remates, "FORA")), Celula.Numero(Contar(remates, "POSTE")),
                Celula.Numero(Contar(remates, "BLOQUEADO")),
                Celula.Numero(Eficacia(Contar(remates, "GOLO"), remates.Count)));
        }
        return folha;
    }

    private static FolhaXlsx FolhaPorCorredor(Contexto c) =>
        FolhaZona(c, "Por corredor", "Corredor", c.Estat.PorCorredor, RotuloCorredor, ordem: OrdemCorredor);

    private static FolhaXlsx FolhaPorDistancia(Contexto c) =>
        FolhaZona(c, "Por distância", "Distância", c.Estat.PorDistancia, RotuloDistancia, ordem: OrdemDistancia);

    private static FolhaXlsx FolhaZona(
        Contexto c, string nome, string titulo, List<EstatZona> zonas, Dictionary<string, string> rotulos, List<string> ordem)
    {
        var folha = Tabela(nome, "Equipa", titulo, "Remates", "Golos", "Eficácia (%)");
        var linhas = zonas
            .Where(z => c.Inclui(z.EquipaId))
            .OrderBy(z => c.OrdemEquipa(z.EquipaId))
            .ThenBy(z => Indice(ordem, z.Zona));

        foreach (var z in linhas)
            folha.Adicionar(
                Celula.Texto(c.NomeEquipa(z.EquipaId)), Celula.Texto(Rotulo(rotulos, z.Zona)),
                Celula.Numero(z.Remates), Celula.Numero(z.Golos), Celula.Numero(z.Eficacia));
        return folha;
    }

    private static FolhaXlsx FolhaPorParte(Contexto c)
    {
        var folha = Tabela("Por parte", "Equipa", "Parte", "Remates", "Golos", "Eficácia (%)");
        var linhas = c.Estat.PorParte
            .Where(p => c.Inclui(p.EquipaId))
            .OrderBy(p => c.OrdemEquipa(p.EquipaId))
            .ThenBy(p => p.Parte);

        foreach (var p in linhas)
            folha.Adicionar(
                Celula.Texto(c.NomeEquipa(p.EquipaId)), Celula.Texto($"{p.Parte}.ª parte"),
                Celula.Numero(p.Remates), Celula.Numero(p.Golos), Celula.Numero(p.Eficacia));
        return folha;
    }

    private static FolhaXlsx FolhaGuardaRedes(Contexto c)
    {
        var folha = Tabela("Guarda-redes", "Equipa", "Nº", "Nome", "Defesas", "Golos sofridos", "Remates à baliza", "Defesa (%)");
        foreach (var gr in c.Estat.GuardaRedes.Where(g => c.Inclui(g.EquipaId))
                     .OrderBy(g => c.OrdemEquipa(g.EquipaId)).ThenBy(g => g.Numero))
        {
            folha.Adicionar(
                Celula.Texto(c.NomeEquipa(gr.EquipaId)), Celula.Numero(gr.Numero), Celula.Texto(gr.Nome),
                Celula.Numero(gr.Defesas), Celula.Numero(gr.GolosSofridos), Celula.Numero(gr.RematesBaliza),
                Celula.Numero(gr.PercentagemDefesa));
        }
        return folha;
    }

    private static FolhaXlsx FolhaOutrosEventos(Contexto c)
    {
        var folha = Tabela("Outros eventos", "Equipa", "Evento", "Total");
        var tipos = c.Dados.Tipos.Where(t => !t.ERemate).OrderBy(t => t.Ordem).ToList();

        foreach (var (equipaId, nomeEquipa) in c.EquipasIncluidas)
        foreach (var tipo in tipos)
        {
            var total = c.Estat.OutrosEventos.FirstOrDefault(o => o.EquipaId == equipaId && o.Tipo == tipo.Codigo)?.Total ?? 0;
            folha.Adicionar(Celula.Texto(nomeEquipa), Celula.Texto(tipo.Nome), Celula.Numero(total));
        }
        return folha;
    }

    private static FolhaXlsx FolhaEventos(Contexto c)
    {
        var folha = Tabela("Eventos", "Nº", "Parte", "Tempo", "Equipa", "Evento", "Jogador Nº", "Jogador", "Posição",
            "Resultado", "Situação", "Corredor", "Distância", "X (%)", "Y (%)");
        folha.FiltroNoCabecalho = true;

        foreach (var e in c.Dados.Eventos.Where(e => c.Inclui(e.EquipaId)).OrderBy(e => e.Id))
        {
            folha.Adicionar(
                Celula.Numero(e.Id), Celula.Numero(e.Parte), Celula.Texto(Tempo(e.SegundoJogo)),
                Celula.Texto(e.EquipaNome), Celula.Texto(e.TipoNome),
                e.JogadorNumero is { } n ? Celula.Numero(n) : Celula.Vazia, Celula.Texto(e.JogadorNome),
                Celula.Texto(e.JogadorPosicao is null ? null : Rotulo(RotuloPosicao, e.JogadorPosicao)),
                Celula.Texto(e.Resultado is null ? null : Rotulo(RotuloResultado, e.Resultado)),
                Celula.Texto(Rotulo(RotuloSituacao, e.Situacao)),
                Celula.Texto(e.Corredor is null ? null : Rotulo(RotuloCorredor, e.Corredor)),
                Celula.Texto(e.Distancia is null ? null : Rotulo(RotuloDistancia, e.Distancia)),
                Celula.Numero(e.X), Celula.Numero(e.Y));
        }
        return folha;
    }

    // ------------------------- Auxiliares -------------------------

    private static FolhaXlsx Tabela(string nome, params string[] colunas)
    {
        var folha = new FolhaXlsx(nome) { CongelarLinhas = 1 };
        folha.Adicionar(colunas.Select(Celula.Cabecalho).ToArray());
        return folha;
    }

    /// <summary>Posição de um código na ordem pretendida (os desconhecidos vão para o fim).</summary>
    private static int Indice(List<string> ordem, string codigo)
    {
        var i = ordem.IndexOf(codigo);
        return i >= 0 ? i : int.MaxValue;
    }

    private static string Rotulo(Dictionary<string, string> rotulos, string codigo) =>
        rotulos.TryGetValue(codigo, out var rotulo) ? rotulo : codigo;

    private static long Contar(List<EventoExport> remates, string resultado) =>
        remates.Count(r => r.Resultado == resultado);

    /// <summary>Golos / remates em percentagem com 1 casa decimal (arredonda como o ROUND do PostgreSQL).</summary>
    public static decimal? Eficacia(long golos, long remates) =>
        remates == 0 ? null : Math.Round(100m * golos / remates, 1, MidpointRounding.AwayFromZero);

    /// <summary>125 segundos → "02:05".</summary>
    public static string Tempo(int segundos)
    {
        var s = Math.Max(0, segundos);
        return $"{s / 60:00}:{s % 60:00}";
    }

    private static string DataLocal(DateTime utc, TimeZoneInfo fuso)
    {
        var instante = DateTime.SpecifyKind(utc, DateTimeKind.Utc);
        return TimeZoneInfo.ConvertTimeFromUtc(instante, fuso).ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
    }

    /// <summary>"Águias do Norte" → "aguias-do-norte".</summary>
    public static string Slug(string? texto)
    {
        var sb = new StringBuilder();
        foreach (var ch in (texto ?? "").Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
            if (ch is >= 'a' and <= 'z' or >= '0' and <= '9') sb.Append(ch);
            else if (ch is >= 'A' and <= 'Z') sb.Append(char.ToLowerInvariant(ch));
            else if (sb.Length > 0 && sb[^1] != '-') sb.Append('-');
        }
        return sb.ToString().Trim('-');
    }
}
