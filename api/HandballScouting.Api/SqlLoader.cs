using System.Collections.Concurrent;

namespace HandballScouting.Api;

/// <summary>Lê as consultas dos ficheiros Sql/*.sql (com cache em memória).</summary>
public sealed class SqlLoader
{
    private readonly ConcurrentDictionary<string, string> _cache = new();
    private readonly string _pasta = Path.Combine(AppContext.BaseDirectory, "Sql");

    public string this[string nome] =>
        _cache.GetOrAdd(nome, n => File.ReadAllText(Path.Combine(_pasta, n + ".sql")));

    /// <summary>
    /// Várias consultas num só texto, separadas por ";", para seguirem para a base de dados num só pedido
    /// (lêem-se depois pela mesma ordem com o QueryMultiple do Dapper). Cada ficheiro tem de acabar em ";".
    /// </summary>
    public string Juntas(params string[] nomes) =>
        _cache.GetOrAdd("+" + string.Join("+", nomes), _ => string.Join("\n", nomes.Select(n => this[n].TrimEnd())));
}
