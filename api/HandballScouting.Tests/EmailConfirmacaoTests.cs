using HandballScouting.Api;

namespace HandballScouting.Tests;

public class EmailConfirmacaoTests
{
    private const string Token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    [Fact]
    public void O_link_junta_o_endereco_da_app_e_o_codigo()
    {
        Assert.Equal($"https://scouting.exemplo.pt/verificar.html?t={Token}", EmailConfirmacao.LinkDe("https://scouting.exemplo.pt", Token));
    }

    [Fact]
    public void O_link_nao_fica_com_barra_a_mais()
    {
        Assert.Equal($"http://localhost:8080/verificar.html?t={Token}", EmailConfirmacao.LinkDe("http://localhost:8080/", Token));
    }

    [Fact]
    public void O_texto_leva_o_nome_e_o_link()
    {
        var link = EmailConfirmacao.LinkDe("http://localhost:8080", Token);
        var texto = EmailConfirmacao.Texto("Ana", link);
        Assert.Contains("Olá Ana,", texto);
        Assert.Contains(link, texto);
        Assert.Contains("24 horas", texto);
    }

    [Fact]
    public void Um_nome_com_quebras_de_linha_fica_numa_so_linha()
    {
        var texto = EmailConfirmacao.Texto("Ana\r\nBcc: mal@exemplo.pt", "http://x/verificar.html?t=1");
        Assert.Contains("Olá Ana Bcc: mal@exemplo.pt,", texto);
        Assert.DoesNotContain("\r", texto.Split('\n')[0]);
    }

    [Fact]
    public void O_html_escapa_o_nome()
    {
        var html = EmailConfirmacao.Html("<script>alert(1)</script>", $"http://localhost:8080/verificar.html?t={Token}&x=\"y\"");
        Assert.DoesNotContain("<script>", html);
        Assert.Contains("&lt;script&gt;", html);
        Assert.DoesNotContain("x=\"y\"", html);   // as aspas do link também são escapadas
        Assert.Contains($"verificar.html?t={Token}", html);
    }

    [Fact]
    public void O_assunto_diz_o_que_fazer()
    {
        Assert.Contains("Confirma", EmailConfirmacao.Assunto);
    }
}
