namespace HandballScouting.Api;

/// <summary>Regras de validação de equipas, jogadores, jogos e convocatórias (sem base de dados).</summary>
public static class CadastroValidador
{
    public static readonly string[] Posicoes = { "GR", "PE", "LE", "CE", "LD", "PD", "PV" };

    /// <summary>Máximo de jogadores convocados por equipa num jogo de andebol.</summary>
    public const int MaxConvocados = 16;

    public static List<string> ValidarEquipa(NovaEquipaRequest r)
    {
        var erros = new List<string>();
        var nome = r.Nome?.Trim() ?? "";
        if (nome.Length == 0) erros.Add("nome da equipa é obrigatório.");
        else if (nome.Length > 80) erros.Add("nome da equipa tem no máximo 80 caracteres.");
        return erros;
    }

    public static List<string> ValidarJogador(JogadorRequest r)
    {
        var erros = new List<string>();
        if (r.Numero is < 1 or > 99) erros.Add("numero tem de estar entre 1 e 99.");

        var nome = r.Nome?.Trim() ?? "";
        if (nome.Length == 0) erros.Add("nome do jogador é obrigatório.");
        else if (nome.Length > 80) erros.Add("nome do jogador tem no máximo 80 caracteres.");

        if (r.Posicao is null || !Posicoes.Contains(r.Posicao))
            erros.Add($"posicao inválida (usar {string.Join(", ", Posicoes)}).");
        return erros;
    }

    public static List<string> ValidarJogo(NovoJogoRequest r)
    {
        var erros = new List<string>();
        if (r.CasaId == r.ForaId) erros.Add("a equipa da casa e a equipa de fora têm de ser diferentes.");
        if (r.Local is { Length: > 120 }) erros.Add("local tem no máximo 120 caracteres.");
        return erros;
    }

    /// <summary>
    /// Valida uma convocatória: todos os jogadores existem e pertencem a uma das duas equipas do jogo,
    /// e cada equipa tem no máximo <paramref name="maximo"/> convocados.
    /// </summary>
    public static List<string> ValidarConvocatoria(
        IReadOnlyCollection<int> pedidos, IReadOnlyCollection<JogadorBasico> existentes,
        int casaId, int foraId, int maximo = MaxConvocados)
    {
        var erros = new List<string>();
        var porId = existentes.ToDictionary(j => j.Id);
        var ids = pedidos.Distinct().ToList();

        foreach (var id in ids)
        {
            if (!porId.TryGetValue(id, out var jogador))
                erros.Add($"o jogador {id} não existe.");
            else if (jogador.EquipaId != casaId && jogador.EquipaId != foraId)
                erros.Add($"o jogador {id} não pertence a nenhuma das equipas do jogo.");
        }

        if (erros.Count > 0) return erros;

        var daCasa = ids.Count(id => porId[id].EquipaId == casaId);
        var deFora = ids.Count(id => porId[id].EquipaId == foraId);
        if (daCasa > maximo) erros.Add($"máximo de {maximo} convocados por equipa (a equipa da casa tem {daCasa}).");
        if (deFora > maximo) erros.Add($"máximo de {maximo} convocados por equipa (a equipa de fora tem {deFora}).");
        return erros;
    }
}
