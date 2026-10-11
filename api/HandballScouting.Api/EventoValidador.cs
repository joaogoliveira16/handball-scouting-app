namespace HandballScouting.Api;

/// <summary>Regras de validação de um novo evento (sem acesso à base de dados).</summary>
public static class EventoValidador
{
    public static readonly string[] Resultados = { "GOLO", "DEFESA", "FORA", "POSTE", "BLOQUEADO" };
    public static readonly string[] Situacoes = { "POSICIONAL", "CONTRA_ATAQUE", "SETE_METROS" };

    public static List<string> Validar(NovoEventoRequest r, bool eRemate)
    {
        var erros = new List<string>();

        if (r.Parte is not (1 or 2))
            erros.Add("parte tem de ser 1 ou 2.");

        if (r.SegundoJogo is < 0 or > 7200)
            erros.Add("segundoJogo tem de estar entre 0 e 7200.");

        if (!Situacoes.Contains(r.Situacao ?? "POSICIONAL"))
            erros.Add($"situacao inválida (usar {string.Join(", ", Situacoes)}).");

        if (eRemate)
        {
            if (r.JogadorId is null)
                erros.Add("jogadorId é obrigatório num remate.");

            if (r.Resultado is null || !Resultados.Contains(r.Resultado))
                erros.Add($"resultado inválido (usar {string.Join(", ", Resultados)}).");

            if (r.X is null || r.Y is null || r.X < 0 || r.X > 100 || r.Y < 0 || r.Y > 100)
                erros.Add("x e y são obrigatórios num remate e têm de estar entre 0 e 100.");
        }
        else if (r.Resultado is not null || r.X is not null || r.Y is not null || r.GuardaRedesId is not null)
        {
            erros.Add("eventos que não são remates não levam resultado, coordenadas nem guarda-redes.");
        }

        return erros;
    }
}
