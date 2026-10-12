using HandballScouting.Api;

namespace HandballScouting.Tests;

public class EmailRedefinicaoTests
{
    private const string Token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    [Fact]
    public void O_link_aponta_para_a_pagina_de_redefinir_com_o_codigo()
    {
        Assert.Equal($"https://scouting.exemplo.pt/redefinir.html?t={Token}", EmailRedefinicao.LinkDe("https://scouting.exemplo.pt/", Token));
    }

    [Fact]
    public void O_texto_leva_o_nome_o_link_e_a_validade()
    {
        var link = EmailRedefinicao.LinkDe("http://localhost:8080", Token);
        var texto = EmailRedefinicao.Texto("Ana", link);
        Assert.Contains("Olá Ana,", texto);
        Assert.Contains(link, texto);
        Assert.Contains("1 hora", texto);
        Assert.Contains("a tua palavra-passe não muda", texto);
    }

    [Fact]
    public void Um_nome_com_quebras_de_linha_fica_numa_so_linha()
    {
        var texto = EmailRedefinicao.Texto("Ana\r\nBcc: mal@exemplo.pt", "http://x/redefinir.html?t=1");
        Assert.Contains("Olá Ana Bcc: mal@exemplo.pt,", texto);
    }

    [Fact]
    public void O_html_escapa_o_nome_e_o_link()
    {
        var html = EmailRedefinicao.Html("<script>alert(1)</script>", $"http://localhost:8080/redefinir.html?t={Token}&x=\"y\"");
        Assert.DoesNotContain("<script>", html);
        Assert.Contains("&lt;script&gt;", html);
        Assert.DoesNotContain("x=\"y\"", html);
        Assert.Contains($"redefinir.html?t={Token}", html);
    }

    [Fact]
    public void O_assunto_e_diferente_do_da_confirmacao()
    {
        Assert.Contains("palavra-passe", EmailRedefinicao.Assunto);
        Assert.NotEqual(EmailConfirmacao.Assunto, EmailRedefinicao.Assunto);
    }
}
