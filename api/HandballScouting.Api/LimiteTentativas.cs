namespace HandballScouting.Api;

/// <summary>
/// Trava quem tenta adivinhar uma palavra-passe: depois de <c>maximo</c> falhas seguidas para o mesmo email
/// dentro da janela, essa conta fica bloqueada até a janela acabar. Fica em memória (reinicia com a API).
/// </summary>
public sealed class LimiteTentativas(TimeProvider relogio, int maximo = 5, TimeSpan? janela = null)
{
    private readonly TimeSpan _janela = janela ?? TimeSpan.FromMinutes(10);
    private readonly Dictionary<string, (int Falhas, DateTimeOffset Inicio)> _estado = new();
    private readonly object _trinco = new();

    public TimeSpan Janela => _janela;

    public bool Bloqueado(string chave)
    {
        lock (_trinco)
        {
            if (!_estado.TryGetValue(chave, out var e)) return false;
            if (relogio.GetUtcNow() - e.Inicio >= _janela)
            {
                _estado.Remove(chave);
                return false;
            }
            return e.Falhas >= maximo;
        }
    }

    public void RegistarFalha(string chave)
    {
        lock (_trinco)
        {
            var agora = relogio.GetUtcNow();
            if (_estado.Count > 10_000)   // não deixa a memória crescer sem fim
            {
                foreach (var velha in _estado.Where(p => agora - p.Value.Inicio >= _janela).Select(p => p.Key).ToList())
                    _estado.Remove(velha);
            }
            if (_estado.TryGetValue(chave, out var e) && agora - e.Inicio < _janela)
                _estado[chave] = (e.Falhas + 1, e.Inicio);
            else
                _estado[chave] = (1, agora);
        }
    }

    public void Limpar(string chave)
    {
        lock (_trinco) _estado.Remove(chave);
    }
}
