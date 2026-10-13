namespace HandballScouting.Api;

/// <summary>
/// Superioridade e inferioridade numérica. Sem acesso à base de dados: recebe os eventos do jogo e o segundo de jogo
/// em que cada um foi registado.
///
/// Regras (andebol):
///  * cada "2 minutos" deixa a equipa com menos um jogador de campo durante 2 minutos;
///  * o vermelho direto e o 3.º "2 minutos" do mesmo jogador (desqualificação) também: a equipa joga 2 minutos
///    com menos um jogador e depois pode repor o jogador em campo;
///  * os 2 minutos não acabam com um golo (ao contrário do futebol de salão, por exemplo);
///  * em campo ficam sempre pelo menos 4 jogadores, por isso conta-se no máximo 2 a menos por equipa;
///  * no ataque 7×6 a equipa troca o guarda-redes por um sétimo jogador de campo e deixa a baliza vazia.
/// </summary>
public static class Numerica
{
    /// <summary>Duração de cada sanção em segundos de jogo.</summary>
    public const int DuracaoSegundos = 120;
    /// <summary>Máximo de jogadores a menos de uma equipa (em campo ficam pelo menos 4).</summary>
    public const int MaximoAMenos = 2;

    public const string TipoSeteSeisInicio = "SETE_SEIS_INICIO";
    public const string TipoSeteSeisFim = "SETE_SEIS_FIM";
    /// <summary>Remates de 7 metros ficam fora destas contas: é um castigo, não depende de quantos estão em campo.</summary>
    public const string SituacaoSeteMetros = "SETE_METROS";

    // Situação numérica de uma equipa quando rematou
    public const string Superioridade = "SUPERIORIDADE";   // o adversário tem menos jogadores em campo
    public const string Igualdade = "IGUALDADE";
    public const string Inferioridade = "INFERIORIDADE";   // a equipa tem menos jogadores em campo
    public const string SeteSeis = "SETE_SEIS";            // ataque sem guarda-redes
    public const string BalizaVazia = "BALIZA_VAZIA";      // a equipa remata contra uma baliza sem guarda-redes (7×6 do adversário)

    public static readonly string[] Situacoes = { Superioridade, Igualdade, Inferioridade, SeteSeis, BalizaVazia };

    /// <summary>Quantos jogadores de campo a equipa tem a menos neste segundo (0, 1 ou 2).</summary>
    public static int JogadoresAMenos(IEnumerable<SuspensaoJogo> suspensoes, int equipaId, int segundo)
    {
        var ativas = suspensoes.Count(s =>
            s.EquipaId == equipaId && s.SegundoJogo <= segundo && segundo < s.SegundoJogo + DuracaoSegundos);
        return Math.Min(ativas, MaximoAMenos);
    }

    /// <summary>
    /// A equipa estava em 7×6 neste momento? Vale o último início ou fim registado até lá (dois eventos no mesmo
    /// segundo desempatam pela ordem em que foram registados).
    /// </summary>
    public static bool SeteSeisAtivo(IEnumerable<SeteSeisEvento> eventos, int equipaId, int segundo, long eventoId = long.MaxValue)
    {
        var ultimo = eventos
            .Where(e => e.EquipaId == equipaId
                        && (e.SegundoJogo < segundo || (e.SegundoJogo == segundo && e.EventoId <= eventoId)))
            .OrderBy(e => e.SegundoJogo).ThenBy(e => e.EventoId)
            .LastOrDefault();
        return ultimo?.Tipo == TipoSeteSeisInicio;
    }

    /// <summary>A situação numérica de <paramref name="equipaId"/> neste momento do jogo.</summary>
    public static string Situacao(
        IReadOnlyList<SuspensaoJogo> suspensoes, IReadOnlyList<SeteSeisEvento> seteSeis,
        int equipaId, int adversarioId, int segundo, long eventoId = long.MaxValue)
    {
        if (SeteSeisAtivo(seteSeis, equipaId, segundo, eventoId)) return SeteSeis;
        if (SeteSeisAtivo(seteSeis, adversarioId, segundo, eventoId)) return BalizaVazia;

        var diferenca = JogadoresAMenos(suspensoes, adversarioId, segundo) - JogadoresAMenos(suspensoes, equipaId, segundo);
        return diferenca > 0 ? Superioridade : diferenca < 0 ? Inferioridade : Igualdade;
    }

    /// <summary>
    /// Tudo o que o dashboard mostra sobre a superioridade numérica. <paramref name="agora"/> é o segundo de jogo atual;
    /// se o relógio nunca foi usado (todos os eventos a 00:00) não se calcula a eficácia nem o tempo, porque seria inventar.
    /// </summary>
    public static NumericaJogo Calcular(
        int casaId, int foraId,
        IReadOnlyList<SuspensaoJogo> suspensoes, IReadOnlyList<SeteSeisEvento> seteSeis,
        IReadOnlyList<RemateMapa> remates, int agora, bool relogioUsado)
    {
        var resultado = new NumericaJogo
        {
            RelogioUsado = relogioUsado,
            Suspensoes = suspensoes.ToList(),
            SeteSeis = new[] { casaId, foraId }.Select(id => EstadoSeteSeis(seteSeis, id)).ToList(),
        };
        if (!relogioUsado) return resultado;

        resultado.Eficacia = Eficacia(casaId, foraId, suspensoes, seteSeis, remates);
        resultado.Tempo = Tempo(casaId, foraId, suspensoes, seteSeis, agora);
        return resultado;
    }

    /// <summary>Estado atual do 7×6 de uma equipa: vale o último início ou fim que foi registado.</summary>
    public static SeteSeisEquipa EstadoSeteSeis(IReadOnlyList<SeteSeisEvento> seteSeis, int equipaId)
    {
        var ultimo = seteSeis.Where(e => e.EquipaId == equipaId).OrderBy(e => e.EventoId).LastOrDefault();
        var ativo = ultimo?.Tipo == TipoSeteSeisInicio;
        return new SeteSeisEquipa { EquipaId = equipaId, Ativo = ativo, Desde = ativo ? ultimo!.SegundoJogo : null };
    }

    private static List<EficaciaNumerica> Eficacia(
        int casaId, int foraId, IReadOnlyList<SuspensaoJogo> suspensoes, IReadOnlyList<SeteSeisEvento> seteSeis,
        IReadOnlyList<RemateMapa> remates)
    {
        var contagem = new Dictionary<(int Equipa, string Situacao), (int Remates, int Golos)>();
        foreach (var r in remates.Where(r => r.Situacao != SituacaoSeteMetros))
        {
            var adversario = r.EquipaId == casaId ? foraId : casaId;
            var situacao = Situacao(suspensoes, seteSeis, r.EquipaId, adversario, r.SegundoJogo, r.Id);
            var (total, golos) = contagem.GetValueOrDefault((r.EquipaId, situacao));
            contagem[(r.EquipaId, situacao)] = (total + 1, golos + (r.Resultado == "GOLO" ? 1 : 0));
        }

        return new[] { casaId, foraId }
            .SelectMany(equipa => Situacoes
                .Where(s => contagem.ContainsKey((equipa, s)))
                .Select(s => new EficaciaNumerica
                {
                    EquipaId = equipa, Situacao = s, Remates = contagem[(equipa, s)].Remates, Golos = contagem[(equipa, s)].Golos,
                }))
            .ToList();
    }

    /// <summary>Segundos que cada equipa passou em superioridade, em inferioridade e em 7×6 até ao segundo <paramref name="agora"/>.</summary>
    private static List<TempoNumerico> Tempo(
        int casaId, int foraId, IReadOnlyList<SuspensaoJogo> suspensoes, IReadOnlyList<SeteSeisEvento> seteSeis, int agora)
    {
        var segundos = new Dictionary<(int Equipa, string Situacao), int>();
        void Somar(int equipa, string situacao, int valor)
        {
            if (valor > 0) segundos[(equipa, situacao)] = segundos.GetValueOrDefault((equipa, situacao)) + valor;
        }

        // A situação só muda quando uma sanção começa ou acaba: entre dois desses momentos é sempre a mesma
        var cortes = new SortedSet<int> { 0, Math.Max(agora, 0) };
        foreach (var s in suspensoes)
        {
            cortes.Add(Math.Clamp(s.SegundoJogo, 0, Math.Max(agora, 0)));
            cortes.Add(Math.Clamp(s.SegundoJogo + DuracaoSegundos, 0, Math.Max(agora, 0)));
        }
        var momentos = cortes.ToList();
        for (var i = 0; i + 1 < momentos.Count; i++)
        {
            var duracao = momentos[i + 1] - momentos[i];
            var casaAMenos = JogadoresAMenos(suspensoes, casaId, momentos[i]);
            var foraAMenos = JogadoresAMenos(suspensoes, foraId, momentos[i]);
            if (foraAMenos > casaAMenos) { Somar(casaId, Superioridade, duracao); Somar(foraId, Inferioridade, duracao); }
            else if (casaAMenos > foraAMenos) { Somar(foraId, Superioridade, duracao); Somar(casaId, Inferioridade, duracao); }
        }

        foreach (var equipa in new[] { casaId, foraId })
        {
            int? inicio = null;
            foreach (var e in seteSeis.Where(e => e.EquipaId == equipa).OrderBy(e => e.SegundoJogo).ThenBy(e => e.EventoId))
            {
                if (e.Tipo == TipoSeteSeisInicio) inicio ??= e.SegundoJogo;
                else if (inicio is int desde)
                {
                    Somar(equipa, SeteSeis, Math.Min(e.SegundoJogo, agora) - Math.Min(desde, agora));
                    inicio = null;
                }
            }
            if (inicio is int aberto) Somar(equipa, SeteSeis, agora - Math.Min(aberto, agora));
        }

        return new[] { casaId, foraId }
            .SelectMany(equipa => new[] { Superioridade, Inferioridade, SeteSeis }
                .Where(s => segundos.ContainsKey((equipa, s)))
                .Select(s => new TempoNumerico { EquipaId = equipa, Situacao = s, Segundos = segundos[(equipa, s)] }))
            .ToList();
    }
}
