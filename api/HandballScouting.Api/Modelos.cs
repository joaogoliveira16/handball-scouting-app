namespace HandballScouting.Api;

// ---------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------

/// <summary>Corpo do POST /api/jogos/{id}/eventos</summary>
public record NovoEventoRequest(
    string TipoEvento,       // REMATE, FALTA_OFENSIVA, ... (tabela tipos_evento)
    int EquipaId,            // equipa a que o evento diz respeito (a que ataca)
    int? JogadorId,          // quem rematou / cometeu a falta
    int? GuardaRedesId,      // guarda-redes adversário (só em remates)
    string? Resultado,       // GOLO | DEFESA | FORA | POSTE | BLOQUEADO (só em remates)
    string? Situacao,        // POSICIONAL | CONTRA_ATAQUE | SETE_METROS (por defeito POSICIONAL)
    decimal? X,              // 0 a 100 (só em remates)
    decimal? Y,              // 0 a 100 (só em remates)
    short Parte,             // 1 ou 2
    int SegundoJogo,         // segundos desde o início do jogo
    decimal? BalizaX = null, // 0 a 100: onde o guarda-redes defendeu (só em DEFESA), da esquerda para a direita de quem remata
    decimal? BalizaY = null); // 0 a 100: da trave (0) ao chão (100)

public record RegistoRequest(string? Nome, string? Email, string? PalavraPasse);

public record EntrarRequest(string? Email, string? PalavraPasse);

public record NovaEquipaRequest(string? Nome);

public record JogadorRequest(int Numero, string? Nome, string? Posicao);

public record NovoJogoRequest(int CasaId, int ForaId, string? Local, DateTimeOffset? DataHora);

public record ConvocatoriaRequest(List<int>? JogadorIds);

public record ResultadoRegisto(bool Ok, int Status, string? Erro, long? Id)
{
    public static ResultadoRegisto Sucesso(long id) => new(true, 201, null, id);
    public static ResultadoRegisto Atualizado() => new(true, 200, null, null);
    public static ResultadoRegisto Falha(int status, string erro) => new(false, status, erro, null);
}

// ---------------------------------------------------------------------
// Linhas lidas da base de dados (classes com setters para o Dapper)
// ---------------------------------------------------------------------

/// <summary>Quem tem sessão iniciada.</summary>
public class Utilizador
{
    public int Id { get; set; }
    public string Nome { get; set; } = "";
    public string Email { get; set; } = "";
}

public class UtilizadorComHash : Utilizador
{
    public string PalavraPasseHash { get; set; } = "";
}

public class TipoEvento
{
    public string Codigo { get; set; } = "";
    public string Nome { get; set; } = "";
    public bool ERemate { get; set; }
    public short Ordem { get; set; }
}

public class JogoEquipas
{
    public int CasaId { get; set; }
    public int ForaId { get; set; }
}

public class JogadorBasico
{
    public int Id { get; set; }
    public int EquipaId { get; set; }
    public string PosicaoCodigo { get; set; } = "";
}

public class JogadorInfo
{
    public int Id { get; set; }
    public int EquipaId { get; set; }
    public short Numero { get; set; }
    public string Nome { get; set; } = "";
    public string Posicao { get; set; } = "";
    public bool Convocado { get; set; }
}

public class EquipaLinha
{
    public int Id { get; set; }
    public string Nome { get; set; } = "";
    public long Jogadores { get; set; }
}

public class JogadorEquipa
{
    public int Id { get; set; }
    public int EquipaId { get; set; }
    public short Numero { get; set; }
    public string Nome { get; set; } = "";
    public string Posicao { get; set; } = "";
    public long Eventos { get; set; }
}

public class EventoExport
{
    public long Id { get; set; }
    public int EquipaId { get; set; }
    public string EquipaNome { get; set; } = "";
    public string Tipo { get; set; } = "";
    public string TipoNome { get; set; } = "";
    public short? JogadorNumero { get; set; }
    public string? JogadorNome { get; set; }
    public string? JogadorPosicao { get; set; }
    public string? Resultado { get; set; }
    public string Situacao { get; set; } = "";
    public string? Corredor { get; set; }
    public string? Distancia { get; set; }
    public decimal? X { get; set; }
    public decimal? Y { get; set; }
    public decimal? BalizaX { get; set; }
    public decimal? BalizaY { get; set; }
    public string? BalizaZona { get; set; }
    public int? GuardaRedesId { get; set; }
    public int? GuardaRedesEquipaId { get; set; }
    public short? GuardaRedesNumero { get; set; }
    public string? GuardaRedesNome { get; set; }
    public short Parte { get; set; }
    public int SegundoJogo { get; set; }
}

/// <summary>Tudo o que o Excel precisa de um jogo.</summary>
public class DadosExportacao
{
    public JogoDetalhe Jogo { get; set; } = new();
    public EstatisticasJogo Estatisticas { get; set; } = new();
    public List<EventoExport> Eventos { get; set; } = new();
    public List<TipoEvento> Tipos { get; set; } = new();
}

public class JogoLinha
{
    public int Id { get; set; }
    public string Codigo { get; set; } = "";   // código do link de partilha do dashboard
    public DateTime DataHora { get; set; }
    public string? Local { get; set; }
    public int CasaId { get; set; }
    public string CasaNome { get; set; } = "";
    public int ForaId { get; set; }
    public string ForaNome { get; set; } = "";
    public long GolosCasa { get; set; }
    public long GolosFora { get; set; }
}

public class JogoDetalhe
{
    public int Id { get; set; }
    public string Codigo { get; set; } = "";   // código do link de partilha do dashboard
    public DateTime DataHora { get; set; }
    public string? Local { get; set; }
    public int CasaId { get; set; }
    public string CasaNome { get; set; } = "";
    public int ForaId { get; set; }
    public string ForaNome { get; set; } = "";
    public int MaxConvocados { get; set; } = CadastroValidador.MaxConvocados;
    public List<JogadorInfo> Jogadores { get; set; } = new();
}

// ---------------------------------------------------------------------
// Estatísticas
// ---------------------------------------------------------------------

public class ResumoEquipa
{
    public int EquipaId { get; set; }
    public string Nome { get; set; } = "";
    public bool ECasa { get; set; }
    public long Remates { get; set; }
    public long Golos { get; set; }
    public long Defesas { get; set; }
    public long Fora { get; set; }
    public long Poste { get; set; }
    public long Bloqueados { get; set; }
    public decimal? Eficacia { get; set; }
}

public class EstatJogador
{
    public int JogadorId { get; set; }
    public int EquipaId { get; set; }
    public short Numero { get; set; }
    public string Nome { get; set; } = "";
    public string Posicao { get; set; } = "";
    public long Remates { get; set; }
    public long Golos { get; set; }
    public decimal? Eficacia { get; set; }
}

public class EstatZona
{
    public int EquipaId { get; set; }
    public string Zona { get; set; } = "";
    public long Remates { get; set; }
    public long Golos { get; set; }
    public decimal? Eficacia { get; set; }
}

public class EstatParte
{
    public int EquipaId { get; set; }
    public short Parte { get; set; }
    public long Remates { get; set; }
    public long Golos { get; set; }
    public decimal? Eficacia { get; set; }
}

public class EstatGuardaRedes
{
    public int JogadorId { get; set; }
    public int EquipaId { get; set; }
    public short Numero { get; set; }
    public string Nome { get; set; } = "";
    public long Defesas { get; set; }
    public long GolosSofridos { get; set; }
    public long RematesBaliza { get; set; }
    public decimal? PercentagemDefesa { get; set; }
}

public class ParcialEquipa
{
    public int EquipaId { get; set; }
    public string Nome { get; set; } = "";
    public long Remates { get; set; }
    public long Golos { get; set; }
}

public class OutroEvento
{
    public int EquipaId { get; set; }
    public string Tipo { get; set; } = "";
    public string Nome { get; set; } = "";
    public long Total { get; set; }
}

public class EventoResumo
{
    public long Id { get; set; }
    public int EquipaId { get; set; }
    public string EquipaNome { get; set; } = "";
    public string Tipo { get; set; } = "";
    public string TipoNome { get; set; } = "";
    public short? JogadorNumero { get; set; }
    public string? JogadorNome { get; set; }
    public string? Resultado { get; set; }
    public string Situacao { get; set; } = "";
    public string? BalizaZona { get; set; }
    public short Parte { get; set; }
    public int SegundoJogo { get; set; }
    public DateTime CriadoEm { get; set; }
}

public class RemateMapa
{
    public long Id { get; set; }
    public int EquipaId { get; set; }
    public int JogadorId { get; set; }
    public short JogadorNumero { get; set; }
    public decimal X { get; set; }
    public decimal Y { get; set; }
    public string Resultado { get; set; } = "";
    public string Situacao { get; set; } = "";
    public decimal? BalizaX { get; set; }
    public decimal? BalizaY { get; set; }
    public string? BalizaZona { get; set; }
}

/// <summary>Resultado das consultas com filtros (eficácia de remate)</summary>
public class ResultadoEficacia
{
    public long Remates { get; set; }
    public long Golos { get; set; }
    public long Defesas { get; set; }
    public long Fora { get; set; }
    public long Poste { get; set; }
    public long Bloqueados { get; set; }
    public decimal? Eficacia { get; set; }
}

/// <summary>Filtros opcionais das consultas de estatísticas. Um filtro a null é ignorado.</summary>
public record FiltroRemates(
    int? EquipaId = null,
    int? JogadorId = null,
    string? Posicao = null,
    string? Corredor = null,
    string? Distancia = null,
    short? Parte = null,
    string? Situacao = null);

/// <summary>Estado completo do jogo, enviado aos dashboards a cada novo evento.</summary>
public class EstatisticasJogo
{
    public int JogoId { get; set; }
    public DateTimeOffset AtualizadoEm { get; set; }
    public List<ResumoEquipa> Equipas { get; set; } = new();
    public List<EstatJogador> Jogadores { get; set; } = new();
    public List<EstatZona> PorCorredor { get; set; } = new();
    public List<EstatZona> PorDistancia { get; set; } = new();
    public List<EstatParte> PorParte { get; set; } = new();
    public List<EstatGuardaRedes> GuardaRedes { get; set; } = new();
    public int ParcialMinutos { get; set; }
    public List<ParcialEquipa> Parcial { get; set; } = new();
    public List<OutroEvento> OutrosEventos { get; set; } = new();
    public List<EventoResumo> UltimosEventos { get; set; } = new();
    public List<RemateMapa> Remates { get; set; } = new();
}
