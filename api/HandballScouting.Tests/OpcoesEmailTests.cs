using HandballScouting.Api;
using Microsoft.Extensions.Configuration;

namespace HandballScouting.Tests;

public class OpcoesEmailTests
{
    private static OpcoesEmail Ler(params (string Chave, string? Valor)[] valores) =>
        OpcoesEmail.Ler(new ConfigurationBuilder()
            .AddInMemoryCollection(valores.Select(v => new KeyValuePair<string, string?>(v.Chave, v.Valor)))
            .Build());

    [Fact]
    public void Sem_configuracao_nao_envia_e_usa_valores_por_omissao()
    {
        var o = Ler();
        Assert.False(o.Configurado);
        Assert.Equal(587, o.Porta);
        Assert.False(o.UsarSsl);
        Assert.Equal("http://localhost:8080", o.UrlPublico);
    }

    [Fact]
    public void Le_o_servidor_a_porta_e_as_credenciais()
    {
        var o = Ler(("Email:Host", "smtp.gmail.com"), ("Email:Porta", "587"), ("Email:Utilizador", "eu@gmail.com"),
                    ("Email:Senha", "abcd efgh"), ("Email:UsarSsl", "true"), ("Email:De", "eu@gmail.com"));
        Assert.True(o.Configurado);
        Assert.Equal("smtp.gmail.com", o.Host);
        Assert.Equal(587, o.Porta);
        Assert.Equal("eu@gmail.com", o.Utilizador);
        Assert.Equal("abcd efgh", o.Senha);   // a senha não leva trim: pode ter espaços
        Assert.True(o.UsarSsl);
        Assert.Equal("eu@gmail.com", o.De);
    }

    [Fact]
    public void Valores_vazios_do_docker_compose_contam_como_nao_definidos()
    {
        var o = Ler(("Email:Host", "mailpit"), ("Email:Porta", "1025"), ("Email:Utilizador", ""), ("Email:Senha", ""),
                    ("Email:UsarSsl", ""), ("Email:De", ""), ("App:UrlPublico", ""));
        Assert.Null(o.Utilizador);
        Assert.Null(o.Senha);
        Assert.False(o.UsarSsl);
        Assert.Equal("scouting@localhost", o.De);
        Assert.Equal("http://localhost:8080", o.UrlPublico);
    }

    [Theory]
    [InlineData("abc")]
    [InlineData("0")]
    [InlineData("70000")]
    public void Porta_invalida_volta_a_587(string porta)
    {
        Assert.Equal(587, Ler(("Email:Host", "smtp.exemplo.pt"), ("Email:Porta", porta)).Porta);
    }

    [Fact]
    public void O_endereco_publico_perde_a_barra_final()
    {
        Assert.Equal("https://scouting.exemplo.pt", Ler(("App:UrlPublico", "https://scouting.exemplo.pt/")).UrlPublico);
    }
}
