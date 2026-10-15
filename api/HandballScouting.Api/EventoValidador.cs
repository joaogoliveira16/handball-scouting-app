namespace HandballScouting.Api;

/// <summary>Regras de validação de um novo evento (sem acesso à base de dados).</summary>
public static class EventoValidador
{
    public static readonly string[] Resultados = { "GOLO", "DEFESA", "FORA", "POSTE", "BLOQUEADO" };
    /// <summary>Código do vermelho direto na tabela tipos_evento (ver db/init/12_expulsoes.sql).</summary>
    public const string TipoVermelho = "VERMELHO";
    public static readonly string[] Situacoes = { "POSICIONAL", "CONTRA_ATAQUE", "SETE_METROS" };
    /// <summary>Resultados em que se marca na baliza o sítio da bola: onde o guarda-redes defendeu ou onde entrou o golo.</summary>
    public static readonly string[] ResultadosComLocalNaBaliza = { "DEFESA", "GOLO" };
    /// <summary>Defesa que o adversário jogava (ver db/init/17_sistema_defensivo.sql); só num remate em ataque posicional.</summary>
    public static readonly string[] SistemasDefensivos = { "6_0", "5_1", "3_2_1", "4_2", "INDIVIDUAL" };

    public static List<string> Validar(NovoEventoRequest r, bool eRemate)
    {
        var erros = new List<string>();

        if (r.Parte is not (1 or 2))
            erros.Add("parte tem de ser 1 ou 2.");

        if (r.SegundoJogo is < 0 or > 7200)
            erros.Add("segundoJogo tem de estar entre 0 e 7200.");

        if (r.ClienteId == Guid.Empty)
            erros.Add("clienteId inválido.");

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
        else if (r.Resultado is not null || r.X is not null || r.Y is not null || r.GuardaRedesId is not null
                 || r.BalizaX is not null || r.BalizaY is not null || r.SistemaDefensivo is not null)
        {
            erros.Add("eventos que não são remates não levam resultado, coordenadas, guarda-redes nem sistema defensivo.");
        }

        // Um vermelho direto é de um jogador (é ele que fica desqualificado)
        if (r.TipoEvento == TipoVermelho && r.JogadorId is null)
            erros.Add("jogadorId é obrigatório num vermelho direto.");

        // Local na baliza (onde o guarda-redes defendeu ou onde entrou o golo): opcional, mas os dois pontos vêm juntos,
        // dentro da baliza e só numa defesa ou num golo
        if (eRemate && (r.BalizaX is not null || r.BalizaY is not null))
        {
            if (r.BalizaX is null || r.BalizaY is null || r.BalizaX < 0 || r.BalizaX > 100 || r.BalizaY < 0 || r.BalizaY > 100)
                erros.Add("balizaX e balizaY vêm juntos e têm de estar entre 0 e 100.");
            if (r.Resultado is null || !ResultadosComLocalNaBaliza.Contains(r.Resultado))
                erros.Add("o local na baliza só existe numa defesa ou num golo.");
        }

        // Sistema defensivo: um dos conhecidos e só contra uma defesa montada (ataque posicional)
        if (eRemate && r.SistemaDefensivo is not null)
        {
            if (!SistemasDefensivos.Contains(r.SistemaDefensivo))
                erros.Add($"sistemaDefensivo inválido (usar {string.Join(", ", SistemasDefensivos)}).");
            if ((r.Situacao ?? "POSICIONAL") != "POSICIONAL")
                erros.Add("o sistema defensivo só existe num remate em ataque posicional.");
        }

        return erros;
    }
}
