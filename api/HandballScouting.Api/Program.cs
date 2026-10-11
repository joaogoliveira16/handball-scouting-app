using Dapper;
using HandballScouting.Api;
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
builder.Services.AddScoped<EstatisticasService>();
builder.Services.AddScoped<EventosService>();
builder.Services.AddSignalR();

var app = builder.Build();

var api = app.MapGroup("/api");

api.MapGet("/saude", async (NpgsqlDataSource dados) =>
{
    await using var con = await dados.OpenConnectionAsync();
    await con.ExecuteScalarAsync<int>("SELECT 1");
    return Results.Ok(new { estado = "ok" });
});

api.MapGet("/tipos-evento", async (EstatisticasService est, CancellationToken ct) =>
    Results.Ok(await est.TiposEventoAsync(ct)));

api.MapGet("/jogos", async (EstatisticasService est, CancellationToken ct) =>
    Results.Ok(await est.JogosAsync(ct)));

api.MapGet("/jogos/{id:int}", async (int id, EstatisticasService est, CancellationToken ct) =>
    await est.JogoAsync(id, ct) is { } jogo ? Results.Ok(jogo) : Results.NotFound(new { erro = "Jogo não encontrado." }));

api.MapGet("/jogos/{id:int}/estatisticas", async (int id, EstatisticasService est, CancellationToken ct) =>
    await est.ObterAsync(id, ct) is { } estado ? Results.Ok(estado) : Results.NotFound(new { erro = "Jogo não encontrado." }));

// Eficácia de remate com filtros. Exemplos:
//   /api/jogos/2/estatisticas/eficacia?posicao=LE&distancia=LINHA_9M&parte=2
//   /api/jogos/2/estatisticas/eficacia?equipaId=1&corredor=PONTA
api.MapGet("/jogos/{id:int}/estatisticas/eficacia", async (
    int id, int? equipaId, int? jogadorId, string? posicao, string? corredor,
    string? distancia, short? parte, string? situacao,
    EstatisticasService est, CancellationToken ct) =>
{
    if (!await est.JogoExisteAsync(id, ct))
        return Results.NotFound(new { erro = "Jogo não encontrado." });

    var filtro = new FiltroRemates(equipaId, jogadorId, posicao, corredor, distancia, parte, situacao);
    return Results.Ok(new { filtro, resultado = await est.EficaciaAsync(id, filtro, ct) });
});

// Defesas dos guarda-redes com filtros. Exemplo: remates das pontas
//   /api/jogos/2/estatisticas/guarda-redes?corredor=PONTA
api.MapGet("/jogos/{id:int}/estatisticas/guarda-redes", async (
    int id, int? jogadorId, string? corredor, string? distancia, short? parte, string? situacao,
    EstatisticasService est, CancellationToken ct) =>
{
    if (!await est.JogoExisteAsync(id, ct))
        return Results.NotFound(new { erro = "Jogo não encontrado." });

    var filtro = new FiltroRemates(null, jogadorId, null, corredor, distancia, parte, situacao);
    return Results.Ok(new { filtro, guardaRedes = await est.GuardaRedesAsync(id, filtro, ct) });
});

api.MapPost("/jogos/{id:int}/eventos", async (
    int id, NovoEventoRequest pedido,
    EventosService eventos, EstatisticasService est, IHubContext<JogoHub> hub, CancellationToken ct) =>
{
    var resultado = await eventos.RegistarAsync(id, pedido, ct);
    if (!resultado.Ok)
        return Results.Json(new { erro = resultado.Erro }, statusCode: resultado.Status);

    await EmitirEstadoAsync(id, est, hub);
    return Results.Created($"/api/jogos/{id}/eventos/{resultado.Id}", new { id = resultado.Id });
});

api.MapDelete("/jogos/{id:int}/eventos/{eventoId:long}", async (
    int id, long eventoId,
    EventosService eventos, EstatisticasService est, IHubContext<JogoHub> hub, CancellationToken ct) =>
{
    if (!await eventos.ApagarAsync(id, eventoId, ct))
        return Results.NotFound(new { erro = "Evento não encontrado." });

    await EmitirEstadoAsync(id, est, hub);
    return Results.NoContent();
});

app.MapHub<JogoHub>("/hub/jogo");

app.Run();

// Depois de gravar, envia o estado atualizado a todos os ecrãs ligados a este jogo.
// Corre sem o token do pedido: o evento já foi gravado e os dashboards têm de o receber.
static async Task EmitirEstadoAsync(int jogoId, EstatisticasService est, IHubContext<JogoHub> hub)
{
    var estado = await est.ObterAsync(jogoId);
    if (estado is not null)
        await hub.Clients.Group(JogoHub.Grupo(jogoId)).SendAsync("EstatisticasAtualizadas", estado);
}
