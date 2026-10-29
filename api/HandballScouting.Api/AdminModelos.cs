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
    /// <summary>A última vez que a conta usou a app (null se ainda não usou desde que isto se regista).</summary>
    public DateTime? UltimoAcessoEm { get; set; }
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

/// <summary>Uma linha do registo de alterações. Tipo: conta, evento ou jogo.</summary>
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

/// <summary>
/// Corpo do POST /api/admin/utilizadores/{id}/eliminar: o email da conta que se quer eliminar, escrito por quem eliminou.
/// Serve de segunda confirmação (uma conta eliminada não volta) e a API recusa se não coincidir.
/// </summary>
public record EliminarRequest(string? Email);

/// <summary>O que saiu com uma conta eliminada (devolvido pela função eliminar_conta).</summary>
public class ContaEliminada
{
    public int EquipasEliminadas { get; set; }
    public int JogadoresEliminados { get; set; }
    public int JogosEliminados { get; set; }
}

/// <summary>Resultado de uma ação de administração: Status é o código HTTP da resposta.</summary>
public record ResultadoAdmin(bool Ok, int Status, string? Erro)
{
    public static ResultadoAdmin Sucesso() => new(true, 204, null);
    public static ResultadoAdmin Falha(int status, string erro) => new(false, status, erro);
}

/// <summary>Corpo do PUT /api/admin/utilizadores/{id}: o nome e o email novos da conta.</summary>
public record EditarContaRequest(string? Nome, string? Email);

/// <summary>Corpo do PUT /api/admin/jogos/{id}/terminado: true termina o jogo, false volta a abri-lo.</summary>
public record TerminadoRequest(bool? Terminado);

/// <summary>A linha que a edição de uma conta devolve (ver admin_editar_conta.sql).</summary>
public class ContaEditada
{
    public int Id { get; set; }
    public bool EmailMudou { get; set; }
}

/// <summary>
/// Resultado de editar uma conta. Se o email mudou, a conta volta a ficar por confirmar e segue um email para o endereço
/// novo: EmailEnviado diz se esse email saiu (se não, o admin pode pedir outro com «Repor palavra-passe» ou a conta pede na entrada).
/// </summary>
public record ResultadoEdicaoConta(bool Ok, int Status, string? Erro, bool EmailMudou = false, bool EmailEnviado = false)
{
    public static ResultadoEdicaoConta Falha(int status, string erro) => new(false, status, erro);
}
