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
    decimal? BalizaX = null, // 0 a 100: onde o guarda-redes defendeu ou onde entrou o golo (só em DEFESA e GOLO), da esquerda para a direita de quem remata
    decimal? BalizaY = null, // 0 a 100: da trave (0) ao chão (100)
    Guid? ClienteId = null,  // identificador gerado no tablet: repetir o envio do mesmo evento não o regista duas vezes
    DateTimeOffset? OcorridoEm = null); // quando o evento aconteceu no tablet (sem rede, o envio pode vir muito depois)

/// <summary>Corpo do PUT /api/jogos/{id}/relogio: o tablet do banco diz em que segundo está o relógio e se está a andar.</summary>
public record RelogioRequest(int? Segundo, bool? ACorrer);

public record RegistoRequest(string? Nome, string? Email, string? PalavraPasse, string? Equipa = null);   // Equipa: a equipa da conta

public record EntrarRequest(string? Email, string? PalavraPasse);

public record ConfirmarEmailRequest(string? Token);

public record ReenviarConfirmacaoRequest(string? Email);

public record EsqueciPalavraPasseRequest(string? Email);

public record RedefinirPalavraPasseRequest(string? Token, string? PalavraPasse);

public record NovaEquipaRequest(string? Nome);

public record JogadorRequest(int Numero, string? Nome, string? Posicao);

public record NovoJogoRequest(int CasaId, int ForaId, string? Local, DateTimeOffset? DataHora);

public record ConvocatoriaRequest(List<int>? JogadorIds);

/// <summary>Mostrar (true) ou esconder (false) o jogo na lista de jogos da área de convidado.</summary>
public record VisibilidadeRequest(bool? Visivel);

public record ResultadoRegisto(bool Ok, int Status, string? Erro, long? Id, bool Repetido = false)
{
    public static ResultadoRegisto Sucesso(long id) => new(true, 201, null, id);
    /// <summary>O tablet já tinha enviado este evento (mesmo clienteId): devolve o que ficou registado.</summary>
    public static ResultadoRegisto JaRegistado(long id) => new(true, 200, null, id, true);
    public static ResultadoRegisto Atualizado() => new(true, 200, null, null);
    public static ResultadoRegisto Falha(int status, string erro) => new(false, status, erro, null);
}

/// <summary>Resultado de guardar o relógio: Mudou = arrancou, parou ou saltou (e não só um aviso periódico).</summary>
public record ResultadoRelogio(bool Ok, int Status, string? Erro, bool Mudou)
{
    public static ResultadoRelogio Guardado(bool mudou) => new(true, 204, null, mudou);
    public static ResultadoRelogio Falha(int status, string erro) => new(false, status, erro, false);
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
    public bool EmailVerificado { get; set; }
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
    public bool Propria { get; set; }   // true = a equipa da conta; false = adversária
    public long? Escudo { get; set; }   // versão do escudo (vai no endereço da imagem); null = sem escudo
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
    public bool VisivelConvidados { get; set; } = true;   // pode aparecer na área de convidado durante 24 horas
    public int CasaId { get; set; }
    public string CasaNome { get; set; } = "";
    public long? CasaEscudo { get; set; }   // versão do escudo; null = sem escudo
    public int ForaId { get; set; }
    public string ForaNome { get; set; } = "";
    public long? ForaEscudo { get; set; }
    public long GolosCasa { get; set; }
    public long GolosFora { get; set; }
}

/// <summary>Um jogo que está a ser registado agora, como o vê quem não tem conta (sem o código do link de partilha).</summary>
public class JogoEmDireto
{
    public int Id { get; set; }
    public DateTime DataHora { get; set; }
    public string? Local { get; set; }
    public int CasaId { get; set; }
    public string CasaNome { get; set; } = "";
    public long? CasaEscudo { get; set; }
    public int ForaId { get; set; }
    public string ForaNome { get; set; } = "";
    public long? ForaEscudo { get; set; }
    public DateTime? UltimoEvento { get; set; }   // null = ainda sem eventos
    public long GolosCasa { get; set; }
    public long GolosFora { get; set; }
}

public class JogoDetalhe
{
    public int Id { get; set; }
    public string? Codigo { get; set; } = "";   // código do link de partilha do dashboard (só o dono o recebe)
    public DateTime DataHora { get; set; }
    public string? Local { get; set; }
    public int CasaId { get; set; }
    public string CasaNome { get; set; } = "";
    public long? CasaEscudo { get; set; }
    public int ForaId { get; set; }
    public string ForaNome { get; set; } = "";
    public long? ForaEscudo { get; set; }
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
    public long? Escudo { get; set; }   // versão do escudo; null = sem escudo
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

/// <summary>Sanções de um jogador no jogo: expulso = vermelho direto ou 3.º "2 minutos" (a regra está na vista v_sancoes).</summary>
public class SancaoJogador
{
    public int JogadorId { get; set; }
    public int EquipaId { get; set; }
    public short Numero { get; set; }
    public string Nome { get; set; } = "";
    public long DoisMinutos { get; set; }
    public long Vermelhos { get; set; }
    public bool Expulso { get; set; }
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
    /// <summary>Identificador gerado no tablet (null nos eventos que não vieram do banco): o banco usa-o para não contar duas vezes um evento que ainda tem por enviar.</summary>
    public Guid? ClienteId { get; set; }
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
    public int SegundoJogo { get; set; }
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
    public List<SancaoJogador> Sancoes { get; set; } = new();
    public List<EventoResumo> UltimosEventos { get; set; } = new();
    public List<RemateMapa> Remates { get; set; } = new();
    public RelogioJogo Relogio { get; set; } = new();
    public NumericaJogo Numerica { get; set; } = new();
    public AssistenteJogo Assistente { get; set; } = new();
}

/// <summary>Um time-out pedido por uma equipa.</summary>
public class TimeoutJogo
{
    public long EventoId { get; set; }
    public int EquipaId { get; set; }
    public short Parte { get; set; }
    public int SegundoJogo { get; set; }
}

/// <summary>Time-outs de uma equipa: quantos usou e quantos ainda pode pedir agora (3 por jogo, no máximo 2 por parte).</summary>
public class TimeoutsEquipa
{
    public int EquipaId { get; set; }
    public int Usados { get; set; }
    public int NaParte { get; set; }
    public int Restantes { get; set; }
}

/// <summary>Uma sugestão do treinador-assistente. <c>EquipaId</c> é a equipa a quem a sugestão serve.</summary>
public class Sugestao
{
    /// <summary>Identifica a sugestão (regra, equipa e jogador): a mesma sugestão tem sempre o mesmo id.</summary>
    public string Id { get; set; } = "";
    public string Codigo { get; set; } = "";
    /// <summary>urgente, atencao, sugestao ou info.</summary>
    public string Nivel { get; set; } = "";
    public int? EquipaId { get; set; }
    public string Titulo { get; set; } = "";
    public string Detalhe { get; set; } = "";
    [System.Text.Json.Serialization.JsonIgnore]
    public int Prioridade { get; set; }
}

/// <summary>O que o treinador-assistente diz neste momento do jogo (calculado em Assistente.cs).</summary>
public class AssistenteJogo
{
    public List<Sugestao> Sugestoes { get; set; } = new();
    public List<TimeoutsEquipa> Timeouts { get; set; } = new();
}

/// <summary>O relógio do jogo agora (o tablet do banco avisa o servidor quando o relógio arranca, pára ou é ajustado).</summary>
public class RelogioJogo
{
    public int Segundo { get; set; }
    public bool ACorrer { get; set; }
}

/// <summary>Um 2 minutos ou um vermelho direto: deixa a equipa com menos um jogador durante 2 minutos.</summary>
public class SuspensaoJogo
{
    public long EventoId { get; set; }
    public int EquipaId { get; set; }
    public int? JogadorId { get; set; }
    public short? JogadorNumero { get; set; }
    public string Tipo { get; set; } = "";
    public int SegundoJogo { get; set; }
}

/// <summary>Início ou fim de um ataque 7×6 (sete jogadores de campo, sem guarda-redes).</summary>
public class SeteSeisEvento
{
    public long EventoId { get; set; }
    public int EquipaId { get; set; }
    public string Tipo { get; set; } = "";
    public int SegundoJogo { get; set; }
}

/// <summary>Se a equipa está agora a atacar em 7×6 e desde que segundo.</summary>
public class SeteSeisEquipa
{
    public int EquipaId { get; set; }
    public bool Ativo { get; set; }
    public int? Desde { get; set; }
}

/// <summary>Remates e golos de uma equipa numa situação numérica (ver Numerica.Situacoes).</summary>
public class EficaciaNumerica
{
    public int EquipaId { get; set; }
    public string Situacao { get; set; } = "";
    public int Remates { get; set; }
    public int Golos { get; set; }
}

/// <summary>Segundos que a equipa passou numa situação numérica (superioridade, inferioridade ou 7×6).</summary>
public class TempoNumerico
{
    public int EquipaId { get; set; }
    public string Situacao { get; set; } = "";
    public int Segundos { get; set; }
}

/// <summary>Superioridade e inferioridade numérica do jogo (calculadas em Numerica.cs).</summary>
public class NumericaJogo
{
    /// <summary>false se o relógio nunca foi usado: sem o segundo de cada evento não há como saber a situação.</summary>
    public bool RelogioUsado { get; set; }
    public int DuracaoSegundos { get; set; } = Numerica.DuracaoSegundos;
    public List<SuspensaoJogo> Suspensoes { get; set; } = new();
    public List<SeteSeisEquipa> SeteSeis { get; set; } = new();
    public List<EficaciaNumerica> Eficacia { get; set; } = new();
    public List<TempoNumerico> Tempo { get; set; } = new();
}
