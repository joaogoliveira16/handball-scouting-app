namespace HandballScouting.Api;

/// <summary>
/// Treinador-assistente: regras simples sobre os dados que já estão no estado do jogo (sem base de dados e sem
/// adivinhar nada). Cada sugestão traz os números que a justificam, para o treinador poder confiar ou discordar.
/// Todos os limiares estão aqui, no topo, para se acertarem num sítio só.
///
/// A decisão é sempre do treinador: com poucos remates qualquer percentagem engana, por isso cada regra só dispara
/// a partir de um número mínimo de remates, golos ou eventos.
/// </summary>
public static class Assistente
{
    // ----- Time-outs (regras IHF: 3 por jogo, no máximo 2 por parte; outras competições podem ter outros números)
    public const int TimeoutsPorJogo = 3;
    public const int TimeoutsPorParte = 2;
    /// <summary>Segundo de jogo a partir do qual conta como 2.ª parte quando só o relógio diz em que parte vamos.</summary>
    public const int InicioSegundaParte = 1800;
    /// <summary>Diferença de golos no parcial dos últimos minutos a partir da qual se sugere time-out.</summary>
    public const int LimiarParcial = 3;
    /// <summary>Golos seguidos do adversário (sem resposta) a partir dos quais se sugere time-out.</summary>
    public const int SerieDeGolos = 4;

    // ----- Jogadores
    public const int MinRematesJogadorQuente = 4;
    public const int MinGolosJogadorQuente = 3;
    public const int EficaciaJogadorQuente = 70;     // %
    public const int MinRematesJogadorFrio = 5;
    public const int EficaciaJogadorFrio = 25;       // %

    // ----- Guarda-redes (remates à baliza = defesas + golos)
    public const int MinRematesBaliza = 8;
    public const int DefesaGuardaRedesFraco = 20;    // %
    public const int DefesaGuardaRedesForte = 45;    // %

    // ----- Corredor de ataque
    public const int MinRematesCorredor = 5;
    public const int MinGolosCorredor = 4;
    public const int EficaciaCorredor = 70;          // %

    // ----- Situações numéricas
    public const int MinRematesNumerica = 4;
    public const int EficaciaSuperioridadeFraca = 35;   // %
    public const int EficaciaSuperioridadeForte = 65;   // %
    public const int MinEventosSeteSeis = 3;            // golos marcados + sofridos na baliza vazia

    // ----- Perdas de bola
    public const int MinPerdas = 6;
    public const int DiferencaPerdas = 4;

    /// <summary>Mais do que isto só distrai: ficam as sugestões mais importantes.</summary>
    public const int MaximoSugestoes = 6;

    // Importância de cada regra (as mais altas aparecem primeiro)
    private const int PrioTimeout = 100, PrioSancao = 80, PrioSuperioridade = 65, PrioInferioridade = 62, PrioGuardaRedesFraco = 60,
        PrioJogadorQuente = 55, PrioJogadorFrio = 50, PrioCorredor = 45, PrioSeteSeis = 40, PrioGuardaRedesForte = 35, PrioPerdas = 30;

    private static readonly Dictionary<string, string> NomeCorredor = new()
    {
        ["PONTA_ESQ"] = "da ponta esquerda", ["LATERAL_ESQ"] = "do lateral esquerdo", ["CENTRAL"] = "central",
        ["LATERAL_DIR"] = "do lateral direito", ["PONTA_DIR"] = "da ponta direita",
    };

    public static AssistenteJogo Calcular(EstatisticasJogo e, IReadOnlyList<TimeoutJogo> timeouts)
    {
        var resultado = new AssistenteJogo();
        if (e.Equipas.Count != 2) return resultado;

        var parte = ParteAtual(e);
        resultado.Timeouts = e.Equipas.Select(eq => TimeoutsDe(eq.EquipaId, timeouts, parte)).ToList();

        var sugestoes = new List<Sugestao>();
        foreach (var equipa in e.Equipas)
        {
            var adversaria = e.Equipas.First(x => x.EquipaId != equipa.EquipaId);
            sugestoes.AddRange(Timeout(e, equipa, adversaria, timeouts, resultado.Timeouts.First(t => t.EquipaId == equipa.EquipaId)));
            sugestoes.AddRange(Sancoes(e, equipa));
            sugestoes.AddRange(JogadorQuente(e, equipa, adversaria));
            sugestoes.AddRange(JogadorFrio(e, equipa));
            sugestoes.AddRange(GuardaRedes(e, equipa, adversaria));
            sugestoes.AddRange(Corredor(e, equipa, adversaria));
            sugestoes.AddRange(Numerica(e, equipa, adversaria));
            sugestoes.AddRange(Perdas(e, equipa, adversaria));
        }

        resultado.Sugestoes = sugestoes
            .OrderByDescending(s => s.Prioridade).ThenBy(s => s.Id, StringComparer.Ordinal)
            .Take(MaximoSugestoes).ToList();
        return resultado;
    }

    // ------------------------------------------------------------------ time-outs

    /// <summary>Em que parte vamos: o relógio diz 2.ª parte a partir dos 30:00; sem relógio vale a parte do último evento.</summary>
    public static int ParteAtual(EstatisticasJogo e)
    {
        var doRelogio = e.Relogio.Segundo >= InicioSegundaParte ? 2 : 1;
        var doUltimoEvento = e.UltimosEventos.FirstOrDefault()?.Parte ?? 1;
        return Math.Max(doRelogio, doUltimoEvento);
    }

    public static TimeoutsEquipa TimeoutsDe(int equipaId, IReadOnlyList<TimeoutJogo> timeouts, int parteAtual)
    {
        var dela = timeouts.Where(t => t.EquipaId == equipaId).ToList();
        var naParte = dela.Count(t => t.Parte == parteAtual);
        return new TimeoutsEquipa
        {
            EquipaId = equipaId,
            Usados = dela.Count,
            NaParte = naParte,
            Restantes = Math.Max(0, Math.Min(TimeoutsPorJogo - dela.Count, TimeoutsPorParte - naParte)),
        };
    }

    /// <summary>
    /// Sugere time-out à equipa que está a sofrer uma série de golos ou um parcial pesado. Só contam os golos
    /// depois do último time-out dessa equipa (acabado de o pedir, a sugestão não volta a aparecer).
    /// </summary>
    private static IEnumerable<Sugestao> Timeout(
        EstatisticasJogo e, ResumoEquipa atras, ResumoEquipa adiante, IReadOnlyList<TimeoutJogo> timeouts, TimeoutsEquipa direitos)
    {
        var ultimoTimeout = timeouts.Where(t => t.EquipaId == atras.EquipaId).Select(t => t.EventoId).DefaultIfEmpty(0).Max();
        var golos = e.Remates.Where(r => r.Resultado == "GOLO" && r.Id > ultimoTimeout).OrderBy(r => r.Id).ToList();

        var motivos = new List<string>();
        var serie = 0;
        for (var i = golos.Count - 1; i >= 0 && golos[i].EquipaId == adiante.EquipaId; i--) serie++;
        if (serie >= SerieDeGolos) motivos.Add($"{adiante.Nome} marcou {serie} golos seguidos");

        if (e.Numerica.RelogioUsado)
        {
            var inicioJanela = e.Relogio.Segundo - e.ParcialMinutos * 60;
            var recentes = golos.Where(g => g.SegundoJogo > inicioJanela).ToList();
            var deles = recentes.Count(g => g.EquipaId == adiante.EquipaId);
            var nossos = recentes.Count(g => g.EquipaId == atras.EquipaId);
            if (deles - nossos >= LimiarParcial)
                motivos.Add($"parcial de {deles}–{nossos} para {adiante.Nome} nos últimos {e.ParcialMinutos} minutos");
        }
        if (motivos.Count == 0) yield break;

        var porque = Maiuscula(string.Join(" e ", motivos)) + ".";
        if (direitos.Restantes > 0)
        {
            yield return Nova("TIMEOUT", "urgente", atras.EquipaId, null, PrioTimeout,
                $"Time-out: {atras.Nome}", $"{porque} {Plural(direitos.Restantes, "Resta", "Restam")} {Plural(direitos.Restantes, "1 time-out", $"{direitos.Restantes} time-outs")}.");
        }
        else
        {
            yield return Nova("TIMEOUT", "atencao", atras.EquipaId, null, PrioTimeout,
                $"{atras.Nome} sem time-outs", $"{porque} Já não tem time-outs para pedir (usou {direitos.Usados}; no máximo {TimeoutsPorParte} por parte).");
        }
    }

    // ------------------------------------------------------------------ sanções

    private static IEnumerable<Sugestao> Sancoes(EstatisticasJogo e, ResumoEquipa equipa)
    {
        foreach (var s in e.Sancoes.Where(s => s.EquipaId == equipa.EquipaId && !s.Expulso && s.DoisMinutos >= 2))
        {
            yield return Nova("SANCAO", "atencao", equipa.EquipaId, s.JogadorId, PrioSancao,
                $"#{s.Numero} {s.Nome} está à beira da expulsão",
                $"Já viu {s.DoisMinutos} exclusões de 2 minutos: à terceira fica desqualificado.");
        }
    }

    // ------------------------------------------------------------------ jogadores

    /// <summary>Quem está "em chamas" é um problema do adversário: sugere marcá-lo de perto.</summary>
    private static IEnumerable<Sugestao> JogadorQuente(EstatisticasJogo e, ResumoEquipa equipa, ResumoEquipa adversaria)
    {
        var quente = e.Jogadores
            .Where(j => j.EquipaId == equipa.EquipaId && j.Remates >= MinRematesJogadorQuente && j.Golos >= MinGolosJogadorQuente
                        && j.Golos * 100 >= EficaciaJogadorQuente * j.Remates)
            .OrderByDescending(j => j.Golos).ThenByDescending(j => 1.0 * j.Golos / j.Remates).ThenBy(j => j.Numero)
            .FirstOrDefault();
        if (quente is null) yield break;
        yield return Nova("MARCAR_JOGADOR", "sugestao", adversaria.EquipaId, quente.JogadorId, PrioJogadorQuente,
            $"Marcar de perto o #{quente.Numero} de {equipa.Nome}",
            $"{quente.Nome}: {Plural(quente.Golos, "1 golo", $"{quente.Golos} golos")} em {quente.Remates} remates ({Pct(quente.Golos, quente.Remates)}).");
    }

    /// <summary>Quem está a falhar muito: sugere à própria equipa rever o jogador.</summary>
    private static IEnumerable<Sugestao> JogadorFrio(EstatisticasJogo e, ResumoEquipa equipa)
    {
        var frio = e.Jogadores
            .Where(j => j.EquipaId == equipa.EquipaId && j.Remates >= MinRematesJogadorFrio && j.Golos * 100 <= EficaciaJogadorFrio * j.Remates)
            .OrderBy(j => 1.0 * j.Golos / j.Remates).ThenByDescending(j => j.Remates).ThenBy(j => j.Numero)
            .FirstOrDefault();
        if (frio is null) yield break;
        yield return Nova("REVER_JOGADOR", "sugestao", equipa.EquipaId, frio.JogadorId, PrioJogadorFrio,
            $"Rever o #{frio.Numero} de {equipa.Nome}",
            $"{frio.Nome}: {Plural(frio.Golos, "1 golo", $"{frio.Golos} golos")} em {frio.Remates} remates ({Pct(frio.Golos, frio.Remates)}).");
    }

    // ------------------------------------------------------------------ guarda-redes

    private static IEnumerable<Sugestao> GuardaRedes(EstatisticasJogo e, ResumoEquipa equipa, ResumoEquipa adversaria)
    {
        foreach (var gr in e.GuardaRedes.Where(g => g.EquipaId == equipa.EquipaId && g.RematesBaliza >= MinRematesBaliza))
        {
            var numeros = $"{gr.Defesas} {(gr.Defesas == 1 ? "defesa" : "defesas")} em {gr.RematesBaliza} remates à baliza ({Pct(gr.Defesas, gr.RematesBaliza)})";
            if (gr.Defesas * 100 <= DefesaGuardaRedesFraco * gr.RematesBaliza)
                yield return Nova("GUARDA_REDES_FRACO", "atencao", equipa.EquipaId, gr.JogadorId, PrioGuardaRedesFraco,
                    $"Considerar trocar o guarda-redes de {equipa.Nome}", $"#{gr.Numero} {gr.Nome}: {numeros}.");
            else if (gr.Defesas * 100 >= DefesaGuardaRedesForte * gr.RematesBaliza)
                yield return Nova("GUARDA_REDES_FORTE", "info", adversaria.EquipaId, gr.JogadorId, PrioGuardaRedesForte,
                    $"Variar os remates contra o #{gr.Numero} de {equipa.Nome}", $"{gr.Nome}: {numeros}.");
        }
    }

    // ------------------------------------------------------------------ corredor de ataque

    /// <summary>O corredor por onde o adversário está a marcar quase sempre: sugere fechá-lo.</summary>
    private static IEnumerable<Sugestao> Corredor(EstatisticasJogo e, ResumoEquipa equipa, ResumoEquipa adversaria)
    {
        var melhor = e.PorCorredor
            .Where(z => z.EquipaId == equipa.EquipaId && z.Remates >= MinRematesCorredor && z.Golos >= MinGolosCorredor
                        && z.Golos * 100 >= EficaciaCorredor * z.Remates)
            .OrderByDescending(z => z.Golos).ThenByDescending(z => 1.0 * z.Golos / z.Remates).ThenBy(z => z.Zona, StringComparer.Ordinal)
            .FirstOrDefault();
        if (melhor is null) yield break;
        var nome = NomeCorredor.GetValueOrDefault(melhor.Zona, melhor.Zona);
        yield return Nova("FECHAR_CORREDOR", "sugestao", adversaria.EquipaId, null, PrioCorredor,
            $"Fechar o corredor {nome}", $"{equipa.Nome} marcou {melhor.Golos} de {melhor.Remates} remates por aí ({Pct(melhor.Golos, melhor.Remates)}).",
            idExtra: melhor.Zona);
    }

    // ------------------------------------------------------------------ situações numéricas

    private static EficaciaNumerica? Linha(EstatisticasJogo e, int equipaId, string situacao) =>
        e.Numerica.Eficacia.FirstOrDefault(x => x.EquipaId == equipaId && x.Situacao == situacao);

    private static IEnumerable<Sugestao> Numerica(EstatisticasJogo e, ResumoEquipa equipa, ResumoEquipa adversaria)
    {
        if (!e.Numerica.RelogioUsado) yield break;

        // Superioridade desperdiçada
        var sup = Linha(e, equipa.EquipaId, Api.Numerica.Superioridade);
        if (sup is { } && sup.Remates >= MinRematesNumerica && sup.Golos * 100 <= EficaciaSuperioridadeFraca * sup.Remates)
            yield return Nova("SUPERIORIDADE_FRACA", "atencao", equipa.EquipaId, null, PrioSuperioridade,
                $"{equipa.Nome} aproveita mal a superioridade",
                $"{Plural(sup.Golos, "1 golo", $"{sup.Golos} golos")} em {sup.Remates} remates com mais um jogador em campo ({Pct(sup.Golos, sup.Remates)}).");

        // O adversário marca muito quando esta equipa joga com menos um
        var contra = Linha(e, adversaria.EquipaId, Api.Numerica.Superioridade);
        if (contra is { } && contra.Remates >= MinRematesNumerica && contra.Golos * 100 >= EficaciaSuperioridadeForte * contra.Remates)
            yield return Nova("INFERIORIDADE_FRACA", "atencao", equipa.EquipaId, null, PrioInferioridade,
                $"Defender melhor em inferioridade ({equipa.Nome})",
                $"{adversaria.Nome} marcou {contra.Golos} de {contra.Remates} remates quando {equipa.Nome} jogava com menos um ({Pct(contra.Golos, contra.Remates)}).");

        // O 7×6 desta equipa a sair caro: mais golos sofridos na baliza vazia do que marcados
        var marcados = Linha(e, equipa.EquipaId, Api.Numerica.SeteSeis)?.Golos ?? 0;
        var sofridos = Linha(e, adversaria.EquipaId, Api.Numerica.BalizaVazia)?.Golos ?? 0;
        if (marcados + sofridos >= MinEventosSeteSeis && sofridos > marcados)
            yield return Nova("SETE_SEIS_CARO", "info", equipa.EquipaId, null, PrioSeteSeis,
                $"O 7×6 de {equipa.Nome} está a sair caro",
                $"{Plural(marcados, "1 golo marcado", $"{marcados} golos marcados")} e {Plural(sofridos, "1 sofrido", $"{sofridos} sofridos")} na baliza vazia.");
    }

    // ------------------------------------------------------------------ perdas de bola

    private static int Perdas(EstatisticasJogo e, int equipaId) =>
        (int)e.OutrosEventos.Where(o => o.EquipaId == equipaId && o.Tipo == "PERDA_BOLA").Sum(o => o.Total);

    private static IEnumerable<Sugestao> Perdas(EstatisticasJogo e, ResumoEquipa equipa, ResumoEquipa adversaria)
    {
        var minhas = Perdas(e, equipa.EquipaId);
        var deles = Perdas(e, adversaria.EquipaId);
        if (minhas >= MinPerdas && minhas - deles >= DiferencaPerdas)
            yield return Nova("PERDAS_DE_BOLA", "info", equipa.EquipaId, null, PrioPerdas,
                $"Muitas perdas de bola de {equipa.Nome}", $"{minhas} perdas contra {deles} do adversário: cuidar da circulação da bola.");
    }

    // ------------------------------------------------------------------ auxiliares

    private static Sugestao Nova(string codigo, string nivel, int equipaId, int? jogadorId, int prioridade, string titulo, string detalhe, string? idExtra = null) => new()
    {
        Id = $"{codigo}:{equipaId}:{jogadorId?.ToString() ?? idExtra ?? "-"}",
        Codigo = codigo, Nivel = nivel, EquipaId = equipaId, Titulo = titulo, Detalhe = detalhe, Prioridade = prioridade,
    };

    private static string Pct(long golos, long remates) => $"{Math.Round(100.0 * golos / remates, MidpointRounding.AwayFromZero)}%";

    private static string Plural(long n, string singular, string plural) => n == 1 ? singular : plural;

    private static string Maiuscula(string texto) => texto.Length == 0 ? texto : char.ToUpperInvariant(texto[0]) + texto[1..];
}
