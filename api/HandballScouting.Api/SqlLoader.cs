using System.Collections.Concurrent;

namespace HandballScouting.Api;

/// <summary>Lê as consultas dos ficheiros Sql/*.sql (com cache em memória).</summary>
public sealed class SqlLoader
{
    private readonly ConcurrentDictionary<string, string> _cache = new();
    private readonly string _pasta = Path.Combine(AppContext.BaseDirectory, "Sql");

    public string this[string nome] =>
        _cache.GetOrAdd(nome, n => File.ReadAllText(Path.Combine(_pasta, n + ".sql")));
}
