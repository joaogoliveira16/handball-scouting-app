using HandballScouting.Api;

namespace HandballScouting.Tests;

public class ExportacaoTests
{
    private static readonly DateTimeOffset Quando = new(2026, 10, 29, 18, 30, 45, TimeSpan.Zero);

    [Theory]
    [InlineData("ana.silva@exemplo.pt", "ana-silva-exemplo-pt")]
    [InlineData("Leões do Sul", "leoes-do-sul")]
    [InlineData("  São João  ", "sao-joao")]
    [InlineData("A&B -- C!!", "a-b-c")]
    [InlineData("---", "sem-nome")]
    [InlineData("", "sem-nome")]
    [InlineData(null, "sem-nome")]
    [InlineData("日本語", "sem-nome")]
    public void A_etiqueta_so_tem_letras_minusculas_numeros_e_hifenes(string? texto, string esperado)
    {
        Assert.Equal(esperado, NomesDeExportacao.Etiqueta(texto));
    }

    [Fact]
    public void A_etiqueta_nao_passa_do_maximo_nem_acaba_em_hifen()
    {
        Assert.Equal("abcdefghij", NomesDeExportacao.Etiqueta("abcdefghij-klmnop", 10));
        Assert.Equal("abcdefghi", NomesDeExportacao.Etiqueta("abcdefghi-klmnop", 10));   // cortar no hífen não o deixa pendurado
        Assert.True(NomesDeExportacao.Etiqueta(new string('x', 200)).Length <= 30);
    }

    [Fact]
    public void O_carimbo_e_em_utc_e_ordena_pelo_nome()
    {
        Assert.Equal("20261029-1830", NomesDeExportacao.Carimbo(Quando));
        Assert.Equal("20261029-1830", NomesDeExportacao.Carimbo(new DateTimeOffset(2026, 10, 29, 19, 30, 0, TimeSpan.FromHours(1))));
    }

    [Fact]
    public void O_ficheiro_de_uma_conta_leva_o_id_o_email_e_a_data()
    {
        Assert.Equal("conta-4-ana-exemplo-pt-20261029-1830.json", NomesDeExportacao.Conta(4, "Ana@exemplo.pt", Quando));
    }

    [Fact]
    public void O_ficheiro_de_um_jogo_leva_o_id_as_duas_equipas_e_a_data()
    {
        Assert.Equal("jogo-12-leoes-vs-falcoes-20261029-1830.json", NomesDeExportacao.Jogo(12, "Leões", "Falcões", Quando));
    }

    [Fact]
    public void O_nome_do_ficheiro_nunca_tem_barras_nem_pontos_do_utilizador()
    {
        var nome = NomesDeExportacao.Conta(1, "../../etc/passwd", Quando);
        Assert.DoesNotContain("/", nome);
        Assert.DoesNotContain("..", nome);
        Assert.EndsWith(".json", nome);
    }
}
