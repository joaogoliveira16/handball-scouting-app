namespace HandballScouting.Api;

/// <summary>
/// O texto do registo de alterações quando um admin corrige ou apaga um evento de um jogo: diz que evento era e o que
/// mudou (de quê para quê), em português, para se perceber sem abrir o jogo.
/// </summary>
public static class DescricaoAlteracoes
{
    private static readonly Dictionary<string, string> Resultados = new()
    {
        ["GOLO"] = "Golo", ["DEFESA"] = "Defesa", ["FORA"] = "Fora", ["POSTE"] = "Poste", ["BLOQUEADO"] = "Bloqueado",
    };

    private static readonly Dictionary<string, string> Situacoes = new()
    {
        ["POSICIONAL"] = "Posicional", ["CONTRA_ATAQUE"] = "Contra-ataque", ["SETE_METROS"] = "7 metros",
    };

    private static readonly Dictionary<string, string> Defesas = new()
    {
        ["6_0"] = "6:0", ["5_1"] = "5:1", ["3_2_1"] = "3:2:1", ["4_2"] = "4:2", ["INDIVIDUAL"] = "Individual",
    };

    private static string Plural(int n, string singular, string plural) => $"{n} {(n == 1 ? singular : plural)}";

    /// <summary>«ana@exemplo.pt (Ana): 2 equipas, 14 jogadores e 3 jogos eliminados».</summary>
    public static string ContaEliminada(UtilizadorAdmin conta, ContaEliminada saiu) =>
        $"{conta.Email} ({conta.Nome}): {Plural(saiu.EquipasEliminadas, "equipa", "equipas")}, "
        + $"{Plural(saiu.JogadoresEliminados, "jogador", "jogadores")} e {Plural(saiu.JogosEliminados, "jogo", "jogos")} eliminados";

    /// <summary>«ana@exemplo.pt (Ana): nome de Ana para Ana Maria; email de ana@exemplo.pt para ana2@exemplo.pt (volta a ficar por confirmar)».</summary>
    public static string ContaEditada(UtilizadorAdmin antes, string nome, string email)
    {
        var mudancas = new List<string>();
        if (nome != antes.Nome) mudancas.Add($"nome de {antes.Nome} para {nome}");
        if (email != antes.Email) mudancas.Add($"email de {antes.Email} para {email} (volta a ficar por confirmar)");
        return $"{antes.Email} ({antes.Nome}): {string.Join("; ", mudancas)}";
    }

    /// <summary>«Leões vs Falcões (conta Ana): 31 eventos apagados».</summary>
    public static string JogoApagado(JogoDetalhe jogo, string donoNome, int eventos) =>
        $"{Jogo(jogo, donoNome)}: {(eventos == 1 ? "1 evento apagado" : $"{eventos} eventos apagados")}";

    /// <summary>135 segundos -> «02:15».</summary>
    public static string Minuto(int segundos)
    {
        var s = Math.Max(0, segundos);
        return $"{s / 60:00}:{s % 60:00}";
    }

    /// <summary>«2.ª 45:20».</summary>
    public static string Tempo(EventoEditavel e) => $"{e.Parte}.ª {Minuto(e.SegundoJogo)}";

    /// <summary>O jogo, para o início do detalhe: «Equipa A vs Equipa B (conta Ana)».</summary>
    public static string Jogo(JogoDetalhe jogo, string donoNome) => $"{jogo.CasaNome} vs {jogo.ForaNome} (conta {donoNome})";

    private static string NomeDaEquipa(JogoDetalhe jogo, int equipaId) => equipaId == jogo.CasaId ? jogo.CasaNome : jogo.ForaNome;

    private static string Quem(int? numero, string? nome) => numero is { } n ? $"#{n} {nome}".TrimEnd() : "sem jogador";

    private static string Rotulo(Dictionary<string, string> tabela, string? codigo, string semValor = "não indicado") =>
        codigo is null ? semValor : tabela.GetValueOrDefault(codigo, codigo);

    /// <summary>O que o evento é: o resultado de um remate («Golo») ou o nome do tipo («Falta»).</summary>
    private static string Natureza(EventoEditavel e) =>
        e.Resultado is { } r ? Rotulo(Resultados, r) : e.TipoNome;

    /// <summary>«2.ª 45:20 · Golo · #7 João Silva · Equipa A».</summary>
    public static string Evento(EventoEditavel e, JogoDetalhe jogo) =>
        $"{Tempo(e)} · {Natureza(e)} · {Quem(e.JogadorNumero, e.JogadorNome)} · {NomeDaEquipa(jogo, e.EquipaId)}";

    /// <summary>
    /// «2.ª 45:20 · Defesa · #7 João Silva · Equipa A: resultado de Defesa para Golo; jogador de #7 João para #9 Rui».
    /// Compara só o que a janela de corrigir deixa mudar.
    /// </summary>
    public static string Correcao(EventoEditavel antes, EventoEditavel depois, JogoDetalhe jogo)
    {
        var mudancas = new List<string>();

        void Comparar(string campo, string de, string para)
        {
            if (de != para) mudancas.Add($"{campo} de {de} para {para}");
        }

        Comparar("equipa", NomeDaEquipa(jogo, antes.EquipaId), NomeDaEquipa(jogo, depois.EquipaId));
        Comparar("tipo", antes.TipoNome, depois.TipoNome);
        Comparar("resultado", Rotulo(Resultados, antes.Resultado, "sem resultado"), Rotulo(Resultados, depois.Resultado, "sem resultado"));
        Comparar("jogador", Quem(antes.JogadorNumero, antes.JogadorNome), Quem(depois.JogadorNumero, depois.JogadorNome));
        Comparar("guarda-redes", Quem(antes.GuardaRedesNumero, antes.GuardaRedesNome), Quem(depois.GuardaRedesNumero, depois.GuardaRedesNome));
        Comparar("situação", Rotulo(Situacoes, antes.Situacao), Rotulo(Situacoes, depois.Situacao));
        Comparar("defesa do adversário", Rotulo(Defesas, antes.SistemaDefensivo), Rotulo(Defesas, depois.SistemaDefensivo));
        Comparar("tempo", Tempo(antes), Tempo(depois));
        if (antes.X != depois.X || antes.Y != depois.Y) mudancas.Add("local no campo alterado");
        if (antes.BalizaX != depois.BalizaX || antes.BalizaY != depois.BalizaY) mudancas.Add("local na baliza alterado");

        return $"{Evento(antes, jogo)}: {(mudancas.Count == 0 ? "sem alterações" : string.Join("; ", mudancas))}";
    }
}
