using HandballScouting.Api;
using Xunit;

namespace HandballScouting.Tests;

public class EmDiretoTests
{
    [Fact]
    public void Quem_abre_um_jogo_em_direto_continua_a_ve_lo_depois_de_ele_sair_da_lista()
    {
        // senão quem recarregasse a página no intervalo de um jogo ficava sem acesso
        Assert.True(JanelasEmDireto.AcessoMinutos > JanelasEmDireto.ListaMinutos);
        Assert.True(JanelasEmDireto.ListaMinutos >= 15, "a lista tem de aguentar um intervalo");
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
