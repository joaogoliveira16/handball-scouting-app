using HandballScouting.Api;
using Microsoft.Extensions.Configuration;

namespace HandballScouting.Tests;

public class OpcoesAdminTests
{
    private static OpcoesAdmin Ler(params (string Chave, string? Valor)[] valores) =>
        OpcoesAdmin.Ler(new ConfigurationBuilder()
            .AddInMemoryCollection(valores.Select(v => new KeyValuePair<string, string?>(v.Chave, v.Valor)))
            .Build());

    [Fact]
    public void Sem_configuracao_ninguem_e_admin()
    {
        var o = Ler();
        Assert.Empty(o.Emails);
        Assert.False(o.Contem("ana@exemplo.pt"));
    }

    [Fact]
    public void Le_a_lista_da_chave_Administracao_Emails()
    {
        var o = Ler(("Administracao:Emails", "ana@exemplo.pt,rui@exemplo.pt"));
        Assert.Equal(new[] { "ana@exemplo.pt", "rui@exemplo.pt" }, o.Emails);
    }

    [Theory]
    [InlineData("ana@exemplo.pt,rui@exemplo.pt")]
    [InlineData("ana@exemplo.pt;rui@exemplo.pt")]
    [InlineData("ana@exemplo.pt rui@exemplo.pt")]
    [InlineData("ana@exemplo.pt\nrui@exemplo.pt")]
    [InlineData("ana@exemplo.pt\r\nrui@exemplo.pt")]
    [InlineData("ana@exemplo.pt\trui@exemplo.pt")]
    [InlineData(" ana@exemplo.pt , ; rui@exemplo.pt ,")]
    public void Aceita_virgula_ponto_e_virgula_espaco_e_quebras_de_linha(string texto)
    {
        Assert.Equal(new[] { "ana@exemplo.pt", "rui@exemplo.pt" }, OpcoesAdmin.De(texto).Emails);
    }

    [Fact]
    public void Os_emails_ficam_normalizados_e_sem_repeticoes()
    {
        var o = OpcoesAdmin.De("  Ana@Exemplo.PT, ana@exemplo.pt ,RUI@exemplo.pt");
        Assert.Equal(new[] { "ana@exemplo.pt", "rui@exemplo.pt" }, o.Emails);
    }

    [Fact]
    public void Contem_ignora_maiusculas_e_espacos()
    {
        var o = OpcoesAdmin.De("ana@exemplo.pt");
        Assert.True(o.Contem("ana@exemplo.pt"));
        Assert.True(o.Contem("  ANA@Exemplo.pt "));
        Assert.False(o.Contem("rui@exemplo.pt"));
        Assert.False(o.Contem("ana@exemplo.pt.mal"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(" , ; ")]
    public void Texto_vazio_nao_da_admin_a_ninguem(string? texto)
    {
        var o = OpcoesAdmin.De(texto);
        Assert.Empty(o.Emails);
        Assert.False(o.Contem(""));
        Assert.False(o.Contem(null));
        Assert.False(o.Contem("ana@exemplo.pt"));
    }

    [Fact]
    public void Valor_vazio_do_docker_compose_conta_como_sem_admins()
    {
        // ADMIN_EMAILS por definir no .env chega à API como "Administracao__Emails=" (vazio)
        var o = Ler(("Administracao:Emails", ""));
        Assert.Empty(o.Emails);
        Assert.False(o.Contem("ana@exemplo.pt"));
    }
}
