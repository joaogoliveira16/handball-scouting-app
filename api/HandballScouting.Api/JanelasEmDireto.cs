namespace HandballScouting.Api;

/// <summary>Durante quanto tempo, depois do último evento, um jogo conta como «em direto» para os convidados.</summary>
public static class JanelasEmDireto
{
    /// <summary>Um jogo aparece na lista «em direto» da área de convidado enquanto o último evento tiver menos disto.</summary>
    public const int ListaMinutos = 30;

    /// <summary>Quem abriu um jogo em direto pode continuar a vê-lo (recarregar, intervalos, o fim do jogo) durante este tempo.</summary>
    public const int AcessoMinutos = 180;
}
