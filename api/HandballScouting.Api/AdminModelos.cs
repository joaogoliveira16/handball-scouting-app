namespace HandballScouting.Api;

// Modelos da área de administração (a página admin.html e as rotas /api/admin).

/// <summary>Os dois papéis de uma conta.</summary>
public static class Papeis
{
    public const string Normal = "normal";
    public const string Admin = "admin";

    public static bool Valido(string? papel) => papel is Normal or Admin;
    public static string Rotulo(string papel) => papel == Admin ? "Admin" : "Normal";
}

/// <summary>Uma conta vista pela administração. Estado: ativo, por_confirmar ou desativado.</summary>
public class UtilizadorAdmin
{
    public int Id { get; set; }
    public string Nome { get; set; } = "";
    public string Email { get; set; } = "";
    public string Papel { get; set; } = Papeis.Normal;
    public DateTime CriadoEm { get; set; }
    public string Estado { get; set; } = "ativo";
    /// <summary>A equipa da conta (null enquanto a conta não tem equipa).</summary>
    public string? Equipa { get; set; }
    public int Jogos { get; set; }
}

public static class EstadosConta
{
    public const string Ativo = "ativo";
    public const string PorConfirmar = "por_confirmar";
    public const string Desativado = "desativado";
}

/// <summary>Um jogo de qualquer conta, na lista da administração.</summary>
public class JogoAdmin
{
    public int Id { get; set; }
    public DateTime DataHora { get; set; }
    public string? Local { get; set; }
    public DateTime? TerminadoEm { get; set; }
    public int? DonoId { get; set; }
    public string? DonoNome { get; set; }
    public string CasaNome { get; set; } = "";
    public string ForaNome { get; set; } = "";
    public int GolosCasa { get; set; }
    public int GolosFora { get; set; }
    public int Eventos { get; set; }
}

/// <summary>O jogo tal como a página de eventos o mostra, mais o nome da conta a que pertence.</summary>
public class JogoDetalheAdmin : JogoDetalhe
{
    public string DonoNome { get; set; } = "";

    public static JogoDetalheAdmin De(JogoDetalhe j, string donoNome) => new()
    {
        Id = j.Id, Codigo = j.Codigo, DataHora = j.DataHora, Local = j.Local, TerminadoEm = j.TerminadoEm,
        CasaId = j.CasaId, CasaNome = j.CasaNome, CasaEscudo = j.CasaEscudo,
        ForaId = j.ForaId, ForaNome = j.ForaNome, ForaEscudo = j.ForaEscudo,
        MaxConvocados = j.MaxConvocados, Jogadores = j.Jogadores, DonoNome = donoNome,
    };
}

/// <summary>A conta dona de um jogo.</summary>
public class DonoDoJogo
{
    public int DonoId { get; set; }
    public string DonoNome { get; set; } = "";
}

/// <summary>Uma linha do registo de alterações. Tipo: conta ou evento.</summary>
public class RegistoAlteracao
{
    public long Id { get; set; }
    public DateTime Quando { get; set; }
    public string AutorNome { get; set; } = "";
    public string Tipo { get; set; } = "";
    public string Acao { get; set; } = "";
    public string Detalhe { get; set; } = "";
    public int? JogoId { get; set; }
}

/// <summary>Corpo do PUT /api/admin/utilizadores/{id}/papel.</summary>
public record PapelRequest(string? Papel);

/// <summary>Corpo do PUT /api/admin/utilizadores/{id}/ativa: true volta a ativar a conta, false desativa-a.</summary>
public record AtivaRequest(bool? Ativa);

/// <summary>Resultado de uma ação de administração: Status é o código HTTP da resposta.</summary>
public record ResultadoAdmin(bool Ok, int Status, string? Erro)
{
    public static ResultadoAdmin Sucesso() => new(true, 204, null);
    public static ResultadoAdmin Falha(int status, string erro) => new(false, status, erro);
}
