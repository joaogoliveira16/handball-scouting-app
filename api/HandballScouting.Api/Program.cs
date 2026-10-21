using Dapper;
using HandballScouting.Api;
using HandballScouting.Api.Excel;
using HandballScouting.Api.Hubs;
using Microsoft.AspNetCore.SignalR;
using Npgsql;

// coluna "golos_casa" -> propriedade GolosCasa
DefaultTypeMap.MatchNamesWithUnderscores = true;

var builder = WebApplication.CreateBuilder(args);

var ligacao = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("Falta ConnectionStrings:Default.");

builder.Services.AddSingleton(NpgsqlDataSource.Create(ligacao));
builder.Services.AddSingleton<SqlLoader>();
builder.Services.AddSingleton(new LimiteTentativas(TimeProvider.System));
builder.Services.AddSingleton(new LimiteEnvios(TimeProvider.System));
// Envio dos emails de confirmação (SMTP). Sem Email__Host o registo funciona, mas o email não segue.
builder.Services.AddSingleton(OpcoesEmail.Ler(builder.Configuration));
builder.Services.AddSingleton<IEnviadorEmail, EnviadorSmtp>();
builder.Services.AddScoped<EstatisticasService>();
builder.Services.AddScoped<EventosService>();
builder.Services.AddScoped<CadastroService>();
builder.Services.AddScoped<ContaService>();
builder.Services.AddScoped<AcessoService>();
builder.Services.AddSignalR();

var app = builder.Build();

if (!app.Services.GetRequiredService<OpcoesEmail>().Configurado)
    app.Logger.LogWarning("Envio de emails não configurado (falta Email__Host): as contas novas não recebem o email de confirmação.");

// Fuso horário das datas no Excel (Exportacao__FusoHorario); UTC se o sistema não o conhecer
var fusoExportacao = ExportadorExcel.ObterFuso(app.Configuration["Exportacao:FusoHorario"]);

var api = app.MapGroup("/api");

// Rotas abertas a todos
api.MapGet("/saude", async (NpgsqlDataSource dados) =>
{
    await using var con = await dados.OpenConnectionAsync();
    await con.ExecuteScalarAsync<int>("SELECT 1");
    return Results.Ok(new { estado = "ok" });
});

api.MapGet("/tipos-evento", async (EstatisticasService est, CancellationToken ct) =>
    Results.Ok(await est.TiposEventoAsync(ct)));

// O escudo de uma equipa. É só o símbolo do clube, por isso qualquer pessoa o pode ver (quem tem o link de um jogo
// também vê os escudos das equipas). O endereço traz ?v=versão: com ela a imagem fica um dia na cache do browser e,
// quando o escudo muda, o endereço muda; sem ela o browser pergunta sempre se mudou (ETag).
api.MapGet("/equipas/{id:int}/escudo", async (int id, HttpContext http, EstatisticasService est, CancellationToken ct) =>
{
    var escudo = await est.EscudoAsync(id, ct);
    if (escudo is null) return Results.NotFound(new { erro = "Esta equipa não tem escudo." });

    var etag = $"\"escudo-{escudo.Versao}\"";
    http.Response.Headers.ETag = etag;
    http.Response.Headers.CacheControl = http.Request.Query.ContainsKey("v") ? "public, max-age=86400" : "no-cache";
    http.Response.Headers["X-Content-Type-Options"] = "nosniff";
    if (http.Request.Headers.IfNoneMatch == etag) return Results.StatusCode(StatusCodes.Status304NotModified);
    return Results.File(escudo.Dados, escudo.Tipo);
});

// Área de convidado: os jogos das últimas 24 horas (sem sessão e sem o código do link de partilha).
// Só aparecem os que o dono não escondeu. O resultado muda a cada evento, por isso não se guarda em cache.
api.MapGet("/convidado/jogos-em-direto", async (HttpContext http, EstatisticasService est, CancellationToken ct) =>
{
    http.Response.Headers.CacheControl = "no-store";
    return Results.Ok(await est.JogosEmDiretoAsync(ct));
});

// ------------------------- Conta -------------------------
// Entrar põe um cookie de sessão (HttpOnly). Quem se regista recebe um email com um link e só entra depois de o abrir.
// Nada disto é guardado em cache.

var conta = api.MapGroup("/conta");

static IResult Falha(ResultadoConta r) =>
    Results.Json(r.Codigo is null ? (object)new { erro = r.Erro } : new { erro = r.Erro, codigo = r.Codigo }, statusCode: r.Status);

conta.MapGet("", async (HttpContext http, CancellationToken ct) =>
{
    http.Response.Headers.CacheControl = "no-store";
    return await Autenticacao.ObterContaAsync(http, ct) is { } c
        ? Results.Ok(new { c.Id, c.Nome, c.Email })
        : Results.Json(new { erro = "Sem sessão iniciada." }, statusCode: 401);
});

conta.MapPost("/registar", async (RegistoRequest pedido, HttpContext http, ContaService contas, CancellationToken ct) =>
{
    http.Response.Headers.CacheControl = "no-store";
    var r = await contas.RegistarAsync(pedido, ct);
    if (!r.Ok) return Falha(r);
    return Results.Json(new { r.Utilizador!.Email, r.EmailEnviado }, statusCode: 201);
});

conta.MapPost("/confirmar-email", async (ConfirmarEmailRequest pedido, HttpContext http, ContaService contas, CancellationToken ct) =>
{
    http.Response.Headers.CacheControl = "no-store";
    var r = await contas.ConfirmarEmailAsync(pedido.Token, ct);
    return r.Ok ? Results.NoContent() : Falha(r);
});

conta.MapPost("/reenviar-confirmacao", async (ReenviarConfirmacaoRequest pedido, HttpContext http, ContaService contas, CancellationToken ct) =>
{
    http.Response.Headers.CacheControl = "no-store";
    var r = await contas.ReenviarConfirmacaoAsync(pedido.Email, ct);
    return r.Ok ? Results.NoContent() : Falha(r);
});

conta.MapPost("/esqueci-palavra-passe", async (EsqueciPalavraPasseRequest pedido, HttpContext http, ContaService contas, CancellationToken ct) =>
{
    http.Response.Headers.CacheControl = "no-store";
    var r = await contas.PedirRedefinicaoAsync(pedido.Email, ct);
    return r.Ok ? Results.NoContent() : Falha(r);
});

conta.MapPost("/redefinir-palavra-passe", async (RedefinirPalavraPasseRequest pedido, HttpContext http, ContaService contas, CancellationToken ct) =>
{
    http.Response.Headers.CacheControl = "no-store";
    var r = await contas.RedefinirPalavraPasseAsync(pedido.Token, pedido.PalavraPasse, ct);
    return r.Ok ? Results.NoContent() : Falha(r);
});

conta.MapPost("/entrar", async (EntrarRequest pedido, HttpContext http, ContaService contas, CancellationToken ct) =>
{
    http.Response.Headers.CacheControl = "no-store";
    var r = await contas.EntrarAsync(pedido, ct);
    if (!r.Ok) return Falha(r);
    Autenticacao.DefinirCookie(http, r.Token!);
    return Results.Ok(new { r.Utilizador!.Id, r.Utilizador.Nome, r.Utilizador.Email });
});

conta.MapPost("/sair", async (HttpContext http, ContaService contas, CancellationToken ct) =>
{
    http.Response.Headers.CacheControl = "no-store";
    await contas.TerminarSessaoAsync(Autenticacao.LerToken(http.Request), ct);
    Autenticacao.ApagarCookie(http);
    return Results.NoContent();
});

// ------------------------- Ver um jogo (dono ou link de partilha) -------------------------
// O dono vê com a sessão; quem recebeu o link traz o código na query (?c=...). Para os outros o jogo não existe.

var leitura = api.MapGroup("/jogos/{id:int}").ExigirAcessoAoJogo();

leitura.MapGet("", async (int id, HttpContext http, EstatisticasService est, AcessoService acesso, CancellationToken ct) =>
{
    if (await est.JogoAsync(id, ct) is not { } jogo) return Results.NotFound(new { erro = "Jogo não encontrado." });
    // O código do link de partilha só vai para o dono: quem vê um jogo em direto sem link não fica com ele
    var conta = await Autenticacao.ObterContaAsync(http, ct);
    if (conta is null || !await acesso.EDonoAsync(id, conta.Id, ct)) jogo.Codigo = null;
    return Results.Ok(jogo);
});

leitura.MapGet("/estatisticas", async (int id, EstatisticasService est, CancellationToken ct) =>
    await est.ObterAsync(id, ct) is { } estado ? Results.Ok(estado) : Results.NotFound(new { erro = "Jogo não encontrado." }));

// Eficácia de remate com filtros. Exemplos:
//   /api/jogos/2/estatisticas/eficacia?posicao=LE&distancia=LINHA_9M&parte=2
//   /api/jogos/2/estatisticas/eficacia?equipaId=1&corredor=PONTA
leitura.MapGet("/estatisticas/eficacia", async (
    int id, int? equipaId, int? jogadorId, string? posicao, string? corredor,
    string? distancia, short? parte, string? situacao,
    EstatisticasService est, CancellationToken ct) =>
{
    var filtro = new FiltroRemates(equipaId, jogadorId, posicao, corredor, distancia, parte, situacao);
    return Results.Ok(new { filtro, resultado = await est.EficaciaAsync(id, filtro, ct) });
});

// Defesas dos guarda-redes com filtros. Exemplo: remates das pontas
//   /api/jogos/2/estatisticas/guarda-redes?corredor=PONTA
leitura.MapGet("/estatisticas/guarda-redes", async (
    int id, int? jogadorId, string? corredor, string? distancia, short? parte, string? situacao,
    EstatisticasService est, CancellationToken ct) =>
{
    var filtro = new FiltroRemates(null, jogadorId, null, corredor, distancia, parte, situacao);
    return Results.Ok(new { filtro, guardaRedes = await est.GuardaRedesAsync(id, filtro, ct) });
});

// Folha de Excel (.xlsx) com as estatísticas do jogo. Com ?equipaId=1 só entram as linhas dessa equipa.
leitura.MapGet("/exportar.xlsx", async (
    int id, int? equipaId, HttpContext http, EstatisticasService est, CancellationToken ct) =>
{
    var dados = await est.ObterExportacaoAsync(id, ct);
    if (dados is null)
        return Results.NotFound(new { erro = "Jogo não encontrado." });
    if (equipaId is { } e && e != dados.Jogo.CasaId && e != dados.Jogo.ForaId)
        return Results.BadRequest(new { erro = "A equipa não participa neste jogo." });

    http.Response.Headers.CacheControl = "no-store";
    var ficheiro = ExportadorExcel.Gerar(dados, equipaId, fusoExportacao);
    return Results.File(ficheiro, ExportadorExcel.TipoMime, ExportadorExcel.NomeFicheiro(dados.Jogo, equipaId));
});

// ------------------------- Só para quem tem conta: tudo o que se vê aqui é da própria conta -------------------------

var protegido = api.MapGroup("").ExigirConta();

protegido.MapGet("/jogos", async (HttpContext http, EstatisticasService est, CancellationToken ct) =>
    Results.Ok(await est.JogosAsync(http.ContaAtual().Id, ct)));

protegido.MapPost("/jogos/{id:int}/eventos", async (
    int id, NovoEventoRequest pedido, HttpContext http,
    EventosService eventos, EstatisticasService est, IHubContext<JogoHub> hub, CancellationToken ct) =>
{
    var resultado = await eventos.RegistarAsync(http.ContaAtual().Id, id, pedido, ct);
    if (!resultado.Ok)
        return Results.Json(new { erro = resultado.Erro }, statusCode: resultado.Status);

    // Também num reenvio: se o aviso da primeira vez falhou, os dashboards ficam atualizados à segunda
    await EmitirEstadoAsync(id, est, hub);
    return resultado.Repetido
        ? Results.Ok(new { id = resultado.Id, repetido = true })
        : Results.Created($"/api/jogos/{id}/eventos/{resultado.Id}", new { id = resultado.Id });
});

// Todos os eventos do jogo (para os rever e corrigir) e a correção de um evento. Só o dono.
protegido.MapGet("/jogos/{id:int}/eventos", async (int id, HttpContext http, EventosService eventos, CancellationToken ct) =>
    await eventos.ListarAsync(http.ContaAtual().Id, id, ct) is { } lista
        ? Results.Ok(lista)
        : Results.NotFound(new { erro = "Jogo não encontrado." }));

protegido.MapPut("/jogos/{id:int}/eventos/{eventoId:long}", async (
    int id, long eventoId, NovoEventoRequest pedido, HttpContext http,
    EventosService eventos, EstatisticasService est, IHubContext<JogoHub> hub, CancellationToken ct) =>
{
    var resultado = await eventos.AtualizarAsync(http.ContaAtual().Id, id, eventoId, pedido, ct);
    if (!resultado.Ok)
        return Results.Json(new { erro = resultado.Erro }, statusCode: resultado.Status);

    await EmitirEstadoAsync(id, est, hub);   // os dashboards abertos passam a mostrar os números corrigidos
    return Results.NoContent();
});

// O tablet do banco avisa quando o relógio arranca, pára ou é ajustado (e de 30 em 30 segundos enquanto corre).
// Só os avisos que mudam alguma coisa vão para os dashboards.
protegido.MapPut("/jogos/{id:int}/relogio", async (
    int id, RelogioRequest pedido, HttpContext http,
    EventosService eventos, EstatisticasService est, IHubContext<JogoHub> hub, CancellationToken ct) =>
{
    var resultado = await eventos.GuardarRelogioAsync(http.ContaAtual().Id, id, pedido, ct);
    if (!resultado.Ok)
        return Results.Json(new { erro = resultado.Erro }, statusCode: resultado.Status);

    if (resultado.Mudou) await EmitirEstadoAsync(id, est, hub);
    return Results.NoContent();
});

protegido.MapDelete("/jogos/{id:int}/eventos/{eventoId:long}", async (
    int id, long eventoId, HttpContext http,
    EventosService eventos, EstatisticasService est, IHubContext<JogoHub> hub, CancellationToken ct) =>
{
    if (!await eventos.ApagarAsync(http.ContaAtual().Id, id, eventoId, ct))
        return Results.NotFound(new { erro = "Evento não encontrado." });

    await EmitirEstadoAsync(id, est, hub);
    return Results.NoContent();
});

// ------------------------- Equipas e jogadores -------------------------

protegido.MapGet("/equipas", async (HttpContext http, CadastroService cadastro, CancellationToken ct) =>
    Results.Ok(await cadastro.EquipasAsync(http.ContaAtual().Id, ct)));

protegido.MapPost("/equipas", async (NovaEquipaRequest pedido, HttpContext http, CadastroService cadastro, CancellationToken ct) =>
{
    var r = await cadastro.CriarEquipaAsync(http.ContaAtual().Id, pedido, ct);
    return r.Ok
        ? Results.Created($"/api/equipas/{r.Id}/jogadores", new { id = r.Id })
        : Results.Json(new { erro = r.Erro }, statusCode: r.Status);
});

// Escudo: o corpo do pedido é a própria imagem (PNG, JPEG ou WebP, até 200 KB). Só o dono da equipa o muda.
protegido.MapPut("/equipas/{id:int}/escudo", async (int id, HttpContext http, CadastroService cadastro, CancellationToken ct) =>
{
    var imagem = await LerCorpoAteAsync(http.Request.Body, Escudos.MaxBytes, ct);
    var r = await cadastro.GuardarEscudoAsync(http.ContaAtual().Id, id, imagem, ct);
    return r.Ok ? Results.Ok(new { escudo = r.Id }) : Results.Json(new { erro = r.Erro }, statusCode: r.Status);
});

protegido.MapDelete("/equipas/{id:int}/escudo", async (int id, HttpContext http, CadastroService cadastro, CancellationToken ct) =>
{
    var r = await cadastro.ApagarEscudoAsync(http.ContaAtual().Id, id, ct);
    return r.Ok ? Results.NoContent() : Results.Json(new { erro = r.Erro }, statusCode: r.Status);
});

protegido.MapGet("/equipas/{id:int}/jogadores", async (int id, HttpContext http, CadastroService cadastro, CancellationToken ct) =>
    await cadastro.JogadoresDaEquipaAsync(http.ContaAtual().Id, id, ct) is { } jogadores
        ? Results.Ok(jogadores)
        : Results.NotFound(new { erro = "Equipa não encontrada." }));

// Os números de cada jogador da equipa, jogo a jogo (a página Estatísticas soma-os)
protegido.MapGet("/equipas/{id:int}/estatisticas", async (int id, HttpContext http, EstatisticasService est, CancellationToken ct) =>
    await est.EquipaAsync(http.ContaAtual().Id, id, ct) is { } estatisticas
        ? Results.Ok(estatisticas)
        : Results.NotFound(new { erro = "Equipa não encontrada." }));

protegido.MapPost("/equipas/{id:int}/jogadores", async (int id, JogadorRequest pedido, HttpContext http, CadastroService cadastro, CancellationToken ct) =>
{
    var r = await cadastro.CriarJogadorAsync(http.ContaAtual().Id, id, pedido, ct);
    return r.Ok
        ? Results.Created($"/api/equipas/{id}/jogadores", new { id = r.Id })
        : Results.Json(new { erro = r.Erro }, statusCode: r.Status);
});

protegido.MapPut("/jogadores/{id:int}", async (int id, JogadorRequest pedido, HttpContext http, CadastroService cadastro, CancellationToken ct) =>
{
    var r = await cadastro.AtualizarJogadorAsync(http.ContaAtual().Id, id, pedido, ct);
    return r.Ok ? Results.NoContent() : Results.Json(new { erro = r.Erro }, statusCode: r.Status);
});

protegido.MapDelete("/jogadores/{id:int}", async (int id, HttpContext http, CadastroService cadastro, CancellationToken ct) =>
{
    var r = await cadastro.ApagarJogadorAsync(http.ContaAtual().Id, id, ct);
    return r.Ok ? Results.NoContent() : Results.Json(new { erro = r.Erro }, statusCode: r.Status);
});

// ------------------------- Novo jogo e convocatória -------------------------

protegido.MapPost("/jogos", async (NovoJogoRequest pedido, HttpContext http, CadastroService cadastro, CancellationToken ct) =>
{
    var r = await cadastro.CriarJogoAsync(http.ContaAtual().Id, pedido, ct);
    return r.Ok
        ? Results.Created($"/api/jogos/{r.Id}", new { id = r.Id })
        : Results.Json(new { erro = r.Erro }, statusCode: r.Status);
});

// Convocatória: ids dos jogadores convocados (lista vazia = ainda sem convocatória)
// Mostrar ou esconder o jogo na lista de jogos em direto da área de convidado
protegido.MapPut("/jogos/{id:int}/visibilidade", async (int id, VisibilidadeRequest pedido, HttpContext http, CadastroService cadastro, CancellationToken ct) =>
{
    var r = await cadastro.DefinirVisibilidadeAsync(http.ContaAtual().Id, id, pedido, ct);
    return r.Ok ? Results.NoContent() : Results.Json(new { erro = r.Erro }, statusCode: r.Status);
});

// Corrigir um jogo (equipas, data, local), marcá-lo como terminado ou apagá-lo. Só o dono.
protegido.MapPut("/jogos/{id:int}", async (
    int id, NovoJogoRequest pedido, HttpContext http,
    CadastroService cadastro, EstatisticasService est, IHubContext<JogoHub> hub, CancellationToken ct) =>
{
    var r = await cadastro.AtualizarJogoAsync(http.ContaAtual().Id, id, pedido, ct);
    if (!r.Ok) return Results.Json(new { erro = r.Erro }, statusCode: r.Status);
    await EmitirEstadoAsync(id, est, hub);
    return Results.NoContent();
});

protegido.MapPut("/jogos/{id:int}/terminado", async (
    int id, TerminarJogoRequest pedido, HttpContext http,
    CadastroService cadastro, EstatisticasService est, IHubContext<JogoHub> hub, CancellationToken ct) =>
{
    var r = await cadastro.TerminarJogoAsync(http.ContaAtual().Id, id, pedido, ct);
    if (!r.Ok) return Results.Json(new { erro = r.Erro }, statusCode: r.Status);
    await EmitirEstadoAsync(id, est, hub);   // os bancos e dashboards abertos passam a mostrar «terminado»
    return Results.NoContent();
});

protegido.MapDelete("/jogos/{id:int}", async (int id, HttpContext http, CadastroService cadastro, CancellationToken ct) =>
{
    var r = await cadastro.ApagarJogoAsync(http.ContaAtual().Id, id, ct);
    return r.Ok ? Results.NoContent() : Results.Json(new { erro = r.Erro }, statusCode: r.Status);
});

protegido.MapGet("/jogos/{id:int}/convocados", async (int id, HttpContext http, CadastroService cadastro, CancellationToken ct) =>
    await cadastro.ConvocadosAsync(http.ContaAtual().Id, id, ct) is { } ids
        ? Results.Ok(new { jogadorIds = ids, maximoPorEquipa = CadastroValidador.MaxConvocados })
        : Results.NotFound(new { erro = "Jogo não encontrado." }));

protegido.MapPut("/jogos/{id:int}/convocados", async (int id, ConvocatoriaRequest pedido, HttpContext http, CadastroService cadastro, CancellationToken ct) =>
{
    var r = await cadastro.DefinirConvocadosAsync(http.ContaAtual().Id, id, pedido, ct);
    return r.Ok ? Results.NoContent() : Results.Json(new { erro = r.Erro }, statusCode: r.Status);
});

app.MapHub<JogoHub>("/hub/jogo");

app.Run();

// Lê o corpo do pedido sem passar de "limite" bytes (devolve um byte a mais se houver mais, para o pedido ser recusado).
static async Task<byte[]> LerCorpoAteAsync(Stream corpo, int limite, CancellationToken ct)
{
    var memoria = new byte[limite + 1];
    var total = 0;
    while (total < memoria.Length)
    {
        var lidos = await corpo.ReadAsync(memoria.AsMemory(total), ct);
        if (lidos == 0) break;
        total += lidos;
    }
    return memoria[..total];
}

// Depois de gravar, envia o estado atualizado a todos os ecrãs ligados a este jogo.
// Corre sem o token do pedido: o evento já foi gravado e os dashboards têm de o receber.
static async Task EmitirEstadoAsync(int jogoId, EstatisticasService est, IHubContext<JogoHub> hub)
{
    var estado = await est.ObterAsync(jogoId);
    if (estado is not null)
        await hub.Clients.Group(JogoHub.Grupo(jogoId)).SendAsync("EstatisticasAtualizadas", estado);
}
