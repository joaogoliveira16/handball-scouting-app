namespace HandballScouting.Api;

/// <summary>Durante quanto tempo um jogo fica aberto a convidados (lista da área de convidado e acesso sem link).</summary>
public static class JanelasEmDireto
{
    /// <summary>
    /// 24 horas, contadas a partir do último evento registado ou, se ainda não há eventos, da data e hora do jogo.
    /// A lista e o acesso usam a mesma janela: um jogo que aparece na lista abre-se, e vice-versa.
    /// </summary>
    public const int Minutos = 24 * 60;
}
