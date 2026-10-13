using HandballScouting.Api;
using Xunit;

namespace HandballScouting.Tests;

public class EmDiretoTests
{
    [Fact]
    public void Um_jogo_fica_aberto_a_convidados_durante_24_horas()
    {
        Assert.Equal(24 * 60, JanelasEmDireto.Minutos);
    }

    [Fact]
    public void Um_jogo_aparece_na_area_de_convidado_por_omissao()
    {
        Assert.True(new JogoLinha().VisivelConvidados);
    }

    [Fact]
    public void Pedido_de_visibilidade_sem_valor_nao_e_nem_verdadeiro_nem_falso()
    {
        Assert.Null(new VisibilidadeRequest(null).Visivel);
        Assert.Equal(false, new VisibilidadeRequest(false).Visivel);
    }
}
