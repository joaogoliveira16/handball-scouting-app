using System.Globalization;

namespace HandballScouting.Api.Excel;

/// <summary>
/// O que se está a ver na página Estatísticas: os jogos (todos, em casa ou fora), a parte (null = o jogo todo) e o período
/// (null = toda a época, ou os N jogos mais recentes depois de escolher o local). O Excel leva só o que o filtro deixa.
/// </summary>
public sealed record FiltrosEstatisticas(string Local = "todos", short? Parte = null, int? Ultimos = null)
{
    public const int MaximoUltimos = 200;

    /// <summary>O que está mal nos filtros, em português (null se estiver tudo bem).</summary>
    public string? Erro() =>
        Local is not ("todos" or "casa" or "fora") ? "local tem de ser todos, casa ou fora."
        : Parte is not null and not (1 or 2) ? "parte tem de ser 1 ou 2."
        : Ultimos is not null and (< 1 or > MaximoUltimos) ? $"ultimos tem de ser um número de 1 a {MaximoUltimos}."
        : null;
}

/// <summary>
/// Constrói o Excel da página Estatísticas: os números dos jogadores da equipa da conta, somados nos jogos que o filtro
/// deixa, com as mesmas três vistas (ataque, guarda-redes, bola e disciplina), os jogos e uma folha jogo a jogo para filtrar.
/// As contas são as da página (frontend/js/estatisticas-jogadores.js).
/// </summary>
public static class ExportadorEstatisticasEquipa
{
    public const string TipoMime = LivroXlsx.TipoMime;

    /// <summary>Ex.: estatisticas-principal-fc-em-casa-2-parte-ultimos-5-jogos.xlsx</summary>
    public static string NomeFicheiro(string equipa, FiltrosEstatisticas filtros)
    {
        var partes = new List<string> { "estatisticas", ExportadorExcel.Slug(equipa) };
        if (filtros.Local == "casa") partes.Add("em-casa");
        else if (filtros.Local == "fora") partes.Add("fora");
        if (filtros.Parte is { } parte) partes.Add($"{parte}-parte");
        if (filtros.Ultimos is { } n) partes.Add($"ultimos-{n}-jogos");
        return string.Join("-", partes.Where(p => p.Length > 0)) + ".xlsx";
    }

    /// <summary>Os jogos que o filtro deixa, do mais antigo para o mais recente (os últimos N contam-se depois do local).</summary>
    public static List<JogoDaEquipa> FiltrarJogos(IEnumerable<JogoDaEquipa> jogos, FiltrosEstatisticas filtros)
    {
        var lista = jogos.OrderBy(j => j.DataHora).ThenBy(j => j.JogoId).ToList();
        if (filtros.Local == "casa") lista = lista.Where(j => j.EmCasa).ToList();
        else if (filtros.Local == "fora") lista = lista.Where(j => !j.EmCasa).ToList();
        if (filtros.Ultimos is { } n && lista.Count > n) lista = lista.Skip(lista.Count - n).ToList();
        return lista;
    }

    /// <summary>
    /// Gera o ficheiro. <paramref name="dados"/> é o que a API devolve para a parte escolhida (a parte já vem aplicada);
    /// aqui aplicam-se o local e os últimos jogos. <paramref name="agora"/> existe para os testes.
    /// </summary>
    public static byte[] Gerar(string equipa, EstatisticasEquipa dados, FiltrosEstatisticas filtros, TimeZoneInfo fuso, DateTimeOffset? agora = null)
    {
        var jogos = FiltrarJogos(dados.Jogos, filtros);
        var ids = jogos.Select(j => j.JogoId).ToHashSet();
        var jogoPorId = jogos.ToDictionary(j => j.JogoId);
        var ordemJogo = jogos.Select((j, i) => (j.JogoId, i)).ToDictionary(x => x.JogoId, x => x.i);
        var linhas = dados.Linhas.Where(l => ids.Contains(l.JogoId)).ToList();

        var jogadores = dados.Plantel.Select(p =>
        {
            var minhas = linhas.Where(l => l.JogadorId == p.Id).ToList();
            var totais = new Totais();
            foreach (var l in minhas) totais.Somar(l);
            return new Jogador(p, totais);
        }).ToList();

        var equipaTotais = new Totais();
        foreach (var l in linhas) equipaTotais.Somar(l);
        equipaTotais.Jogos = jogos.Count;   // os jogos da equipa, não a soma dos jogos de cada jogador

        var contexto = new Contexto(equipa, jogos, jogadores, linhas, jogoPorId, ordemJogo, equipaTotais, filtros, fuso, agora ?? DateTimeOffset.UtcNow, dados.Plantel);
        return LivroXlsx.Gerar(new List<FolhaXlsx>
        {
            FolhaResumo(contexto),
            FolhaJogos(contexto),
            FolhaAtaque(contexto),
            FolhaGuardaRedes(contexto),
            FolhaBolaEDisciplina(contexto),
            FolhaJogoAJogo(contexto),
        });
    }

    // ------------------------- Contas -------------------------

    /// <summary>A soma das linhas de um jogador (ou da equipa) e o que se calcula a partir dela.</summary>
    private sealed class Totais
    {
        public int Jogos;
        public long Remates, Golos, Defendidos, Fora, Poste, Bloqueados, SeteMetros, GolosSeteMetros, ContraAtaques, GolosContraAtaque,
            PerdasBola, FaltasOfensivas, DoisMinutos, Vermelhos, Defesas, GolosSofridos, SeteMetrosSofridos, DefesasSeteMetros;

        public void Somar(JogadorNoJogo l)
        {
            Jogos++;
            Remates += l.Remates; Golos += l.Golos; Defendidos += l.Defendidos; Fora += l.Fora; Poste += l.Poste; Bloqueados += l.Bloqueados;
            SeteMetros += l.SeteMetros; GolosSeteMetros += l.GolosSeteMetros; ContraAtaques += l.ContraAtaques; GolosContraAtaque += l.GolosContraAtaque;
            PerdasBola += l.PerdasBola; FaltasOfensivas += l.FaltasOfensivas; DoisMinutos += l.DoisMinutos; Vermelhos += l.Vermelhos;
            Defesas += l.Defesas; GolosSofridos += l.GolosSofridos; SeteMetrosSofridos += l.SeteMetrosSofridos; DefesasSeteMetros += l.DefesasSeteMetros;
        }

        /// <summary>Fora, poste e bloqueados não chegam ao guarda-redes: só contam as defesas e os golos.</summary>
        public long RematesBaliza => Defesas + GolosSofridos;
        public decimal? Eficacia => Percentagem(Golos, Remates);
        public decimal? PercentagemDefesa => Percentagem(Defesas, RematesBaliza);
        public decimal? GolosPorJogo => Jogos > 0 ? Math.Round((decimal)Golos / Jogos, 1) : null;
        public decimal? DefesasPorJogo => Jogos > 0 ? Math.Round((decimal)Defesas / Jogos, 1) : null;

        private static decimal? Percentagem(long parte, long total) => total > 0 ? Math.Round(100m * parte / total, 1) : null;
    }

    private sealed record Jogador(JogadorEquipa Dados, Totais Totais)
    {
        public bool EGuardaRedes => Dados.Posicao == "GR";
    }

    private sealed record Contexto(
        string NomeEquipa, List<JogoDaEquipa> Jogos, List<Jogador> Jogadores, List<JogadorNoJogo> Linhas,
        Dictionary<int, JogoDaEquipa> JogoPorId, Dictionary<int, int> OrdemJogo, Totais Equipa, FiltrosEstatisticas Filtros,
        TimeZoneInfo Fuso, DateTimeOffset Agora, List<JogadorEquipa> Plantel);

    private static string Resultado(JogoDaEquipa jogo) => jogo.Golos > jogo.GolosAdversario ? "V" : jogo.Golos < jogo.GolosAdversario ? "D" : "E";

    private static string Posicao(string codigo) => ExportadorExcel.RotuloPosicao.TryGetValue(codigo, out var r) ? r : codigo;

    private static string DataLocal(DateTime utc, TimeZoneInfo fuso)
    {
        var instante = DateTime.SpecifyKind(utc, DateTimeKind.Utc);
        return TimeZoneInfo.ConvertTimeFromUtc(instante, fuso).ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture);
    }

    private static Celula N(long valor) => Celula.Numero(valor);
    private static Celula D(decimal? valor) => Celula.Numero(valor);
    private static Celula T(string? texto) => Celula.Texto(texto);

    private static Celula[] Cabecalhos(params string[] textos) => textos.Select(Celula.Cabecalho).ToArray();

    // ------------------------- Folhas -------------------------

    private static FolhaXlsx FolhaResumo(Contexto c)
    {
        var folha = new FolhaXlsx("Resumo");
        folha.Adicionar(Celula.Titulo($"Estatísticas de {c.NomeEquipa}"));
        folha.Adicionar(Celula.Negrito("Números somados nos jogos registados"));
        folha.LinhaVazia();
        folha.Adicionar(Celula.Negrito("Jogos"), T(c.Filtros.Local switch { "casa" => "Em casa", "fora" => "Fora", _ => "Todos" }));
        folha.Adicionar(Celula.Negrito("Parte"), T(c.Filtros.Parte is { } parte ? $"{parte}.ª parte" : "Jogo todo"));
        folha.Adicionar(Celula.Negrito("Período"), T(c.Filtros.Ultimos is { } n ? $"Últimos {n} jogos" : "Toda a época"));
        folha.Adicionar(Celula.Negrito("Exportado em"), T($"{DataLocal(c.Agora.UtcDateTime, c.Fuso)} ({c.Fuso.Id})"));
        if (c.Filtros.Parte is not null)
            folha.Adicionar(Celula.Negrito("Nota"), T("Só contam os jogos com eventos nessa parte; os golos e os resultados são os dessa parte."));
        folha.LinhaVazia();

        var vitorias = c.Jogos.Count(j => Resultado(j) == "V");
        var empates = c.Jogos.Count(j => Resultado(j) == "E");
        var derrotas = c.Jogos.Count(j => Resultado(j) == "D");
        var marcados = c.Jogos.Sum(j => j.Golos);
        var sofridos = c.Jogos.Sum(j => j.GolosAdversario);
        folha.Adicionar(Cabecalhos("Jogos", "Vitórias", "Empates", "Derrotas", "Golos marcados", "Golos sofridos", "Diferença de golos"));
        folha.Adicionar(N(c.Jogos.Count), N(vitorias), N(empates), N(derrotas), N(marcados), N(sofridos), N(marcados - sofridos));
        return folha;
    }

    private static FolhaXlsx FolhaJogos(Contexto c)
    {
        var folha = new FolhaXlsx("Jogos") { CongelarLinhas = 1, FiltroNoCabecalho = true };
        folha.Adicionar(Cabecalhos("Data", "Adversário", "Casa/Fora", "Resultado", "Golos", "Golos sofridos", "Remates", "Eficácia (%)",
            "Defesas", "% de defesa", "Perdas de bola"));
        foreach (var jogo in c.Jogos)
        {
            var t = new Totais();
            foreach (var l in c.Linhas.Where(l => l.JogoId == jogo.JogoId)) t.Somar(l);
            folha.Adicionar(T(DataLocal(jogo.DataHora, c.Fuso)), T(jogo.AdversarioNome), T(jogo.EmCasa ? "Casa" : "Fora"), T(Resultado(jogo)),
                N(jogo.Golos), N(jogo.GolosAdversario), N(t.Remates), D(t.Eficacia), N(t.Defesas), D(t.PercentagemDefesa), N(t.PerdasBola));
        }
        return folha;
    }

    private static FolhaXlsx FolhaAtaque(Contexto c)
    {
        var folha = new FolhaXlsx("Ataque") { CongelarLinhas = 1 };
        folha.Adicionar(Cabecalhos("#", "Jogador", "Posição", "Jogos", "Golos", "Remates", "Eficácia (%)", "Golos por jogo",
            "Golos de 7 m", "Lançamentos de 7 m", "Golos em contra-ataque", "Remates em contra-ataque"));
        // quem rematou ou jogou como jogador de campo; o melhor marcador primeiro
        foreach (var j in c.Jogadores.Where(j => j.Totais.Remates > 0 || (j.Totais.Jogos > 0 && !j.EGuardaRedes))
                     .OrderByDescending(j => j.Totais.Golos).ThenBy(j => j.Dados.Numero))
        {
            var t = j.Totais;
            folha.Adicionar(N(j.Dados.Numero), T(j.Dados.Nome), T(Posicao(j.Dados.Posicao)), N(t.Jogos), N(t.Golos), N(t.Remates), D(t.Eficacia), D(t.GolosPorJogo),
                N(t.GolosSeteMetros), N(t.SeteMetros), N(t.GolosContraAtaque), N(t.ContraAtaques));
        }
        var e = c.Equipa;
        folha.Adicionar(Celula.Vazia, Celula.Negrito("Equipa"), Celula.Vazia, N(e.Jogos), N(e.Golos), N(e.Remates), D(e.Eficacia), D(e.GolosPorJogo),
            N(e.GolosSeteMetros), N(e.SeteMetros), N(e.GolosContraAtaque), N(e.ContraAtaques));
        return folha;
    }

    private static FolhaXlsx FolhaGuardaRedes(Contexto c)
    {
        var folha = new FolhaXlsx("Guarda-redes") { CongelarLinhas = 1 };
        folha.Adicionar(Cabecalhos("#", "Jogador", "Jogos", "Defesas", "Golos sofridos", "Remates à baliza", "% de defesa", "Defesas por jogo",
            "Defesas de 7 m", "Lançamentos de 7 m sofridos"));
        foreach (var j in c.Jogadores.Where(j => j.Totais.RematesBaliza > 0 || (j.Totais.Jogos > 0 && j.EGuardaRedes))
                     .OrderByDescending(j => j.Totais.Defesas).ThenBy(j => j.Dados.Numero))
        {
            var t = j.Totais;
            folha.Adicionar(N(j.Dados.Numero), T(j.Dados.Nome), N(t.Jogos), N(t.Defesas), N(t.GolosSofridos), N(t.RematesBaliza), D(t.PercentagemDefesa),
                D(t.DefesasPorJogo), N(t.DefesasSeteMetros), N(t.SeteMetrosSofridos));
        }
        var e = c.Equipa;
        folha.Adicionar(Celula.Vazia, Celula.Negrito("Equipa"), N(e.Jogos), N(e.Defesas), N(e.GolosSofridos), N(e.RematesBaliza), D(e.PercentagemDefesa),
            D(e.DefesasPorJogo), N(e.DefesasSeteMetros), N(e.SeteMetrosSofridos));
        return folha;
    }

    private static FolhaXlsx FolhaBolaEDisciplina(Contexto c)
    {
        var folha = new FolhaXlsx("Bola e disciplina") { CongelarLinhas = 1 };
        folha.Adicionar(Cabecalhos("#", "Jogador", "Posição", "Jogos", "Perdas de bola", "Faltas ofensivas", "Exclusões de 2 min", "Vermelhos"));
        foreach (var j in c.Jogadores.Where(j => j.Totais.Jogos > 0).OrderByDescending(j => j.Totais.DoisMinutos).ThenBy(j => j.Dados.Numero))
        {
            var t = j.Totais;
            folha.Adicionar(N(j.Dados.Numero), T(j.Dados.Nome), T(Posicao(j.Dados.Posicao)), N(t.Jogos), N(t.PerdasBola), N(t.FaltasOfensivas), N(t.DoisMinutos), N(t.Vermelhos));
        }
        var e = c.Equipa;
        folha.Adicionar(Celula.Vazia, Celula.Negrito("Equipa"), Celula.Vazia, N(e.Jogos), N(e.PerdasBola), N(e.FaltasOfensivas), N(e.DoisMinutos), N(e.Vermelhos));
        return folha;
    }

    /// <summary>Uma linha por jogador e jogo (todos os números), para filtrar e somar como se quiser.</summary>
    private static FolhaXlsx FolhaJogoAJogo(Contexto c)
    {
        var folha = new FolhaXlsx("Jogo a jogo") { CongelarLinhas = 1, FiltroNoCabecalho = true };
        folha.Adicionar(Cabecalhos("Data", "Adversário", "Casa/Fora", "Resultado", "#", "Jogador", "Posição", "Remates", "Golos", "Defendidos", "Fora",
            "Poste", "Bloqueados", "Lançamentos de 7 m", "Golos de 7 m", "Remates em contra-ataque", "Golos em contra-ataque", "Perdas de bola",
            "Faltas ofensivas", "Exclusões de 2 min", "Vermelhos", "Defesas", "Golos sofridos", "Lançamentos de 7 m sofridos", "Defesas de 7 m"));
        var plantel = c.Plantel.ToDictionary(p => p.Id);
        foreach (var l in c.Linhas.Where(l => plantel.ContainsKey(l.JogadorId))
                     .OrderBy(l => c.OrdemJogo[l.JogoId]).ThenBy(l => plantel[l.JogadorId].Numero))
        {
            var jogo = c.JogoPorId[l.JogoId];
            var p = plantel[l.JogadorId];
            folha.Adicionar(T(DataLocal(jogo.DataHora, c.Fuso)), T(jogo.AdversarioNome), T(jogo.EmCasa ? "Casa" : "Fora"),
                T($"{Resultado(jogo)} {jogo.Golos}–{jogo.GolosAdversario}"), N(p.Numero), T(p.Nome), T(Posicao(p.Posicao)),
                N(l.Remates), N(l.Golos), N(l.Defendidos), N(l.Fora), N(l.Poste), N(l.Bloqueados), N(l.SeteMetros), N(l.GolosSeteMetros),
                N(l.ContraAtaques), N(l.GolosContraAtaque), N(l.PerdasBola), N(l.FaltasOfensivas), N(l.DoisMinutos), N(l.Vermelhos),
                N(l.Defesas), N(l.GolosSofridos), N(l.SeteMetrosSofridos), N(l.DefesasSeteMetros));
        }
        return folha;
    }
}
