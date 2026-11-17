using HandballScouting.Api;

namespace HandballScouting.Tests;

public class EstadoEmailTests
{
    [Fact]
    public void Sem_servidor_os_emails_nao_estao_configurados()
    {
        var e = EstadoEmail.DasOpcoes(new OpcoesEmail());
        Assert.Equal(EstadoEmail.NaoConfigurado, e.Modo);
        Assert.Null(e.Host);
    }

    [Theory]
    [InlineData("mailpit")]
    [InlineData("MailPit")]
    [InlineData("localhost")]
    [InlineData("127.0.0.1")]
    [InlineData(" host.docker.internal ")]
    public void Um_servidor_local_e_a_caixa_de_teste(string host)
    {
        Assert.Equal(EstadoEmail.Teste, EstadoEmail.DasOpcoes(new OpcoesEmail { Host = host }).Modo);
    }

    [Theory]
    [InlineData("smtp.gmail.com")]
    [InlineData("smtp-relay.brevo.com")]
    [InlineData("localhost.exemplo.pt")]
    public void Qualquer_outro_servidor_e_real(string host)
    {
        Assert.Equal(EstadoEmail.Real, EstadoEmail.DasOpcoes(new OpcoesEmail { Host = host }).Modo);
    }

    [Fact]
    public void O_estado_nunca_leva_a_senha_nem_o_nome_de_utilizador()
    {
        var e = EstadoEmail.DasOpcoes(new OpcoesEmail { Host = "smtp.gmail.com", Utilizador = "conta-smtp@exemplo.pt", Senha = "segredo-segredo", De = "eu@gmail.com" });
        Assert.True(e.TemUtilizador);
        var json = System.Text.Json.JsonSerializer.Serialize(e);
        Assert.DoesNotContain("segredo", json);
        Assert.DoesNotContain("Senha", json);
        Assert.DoesNotContain("conta-smtp", json);
    }

    [Theory]
    [InlineData("http://localhost:8080", true)]
    [InlineData("http://127.0.0.1:8080", true)]
    [InlineData("https://scouting.exemplo.pt", false)]
    [InlineData("não é um endereço", false)]
    public void O_endereco_publico_de_localhost_so_abre_neste_computador(string url, bool local)
    {
        Assert.Equal(local, EstadoEmail.EhEnderecoLocal(url));
    }

    [Fact]
    public void O_email_de_teste_leva_o_nome_numa_so_linha_e_escapa_o_html()
    {
        Assert.Contains("Olá Ana Bcc: mal@exemplo.pt,", EmailTeste.Texto("Ana\r\nBcc: mal@exemplo.pt"));
        var html = EmailTeste.Html("<b>Ana</b>");
        Assert.Contains("&lt;b&gt;Ana&lt;/b&gt;", html);
        Assert.DoesNotContain("<b>Ana</b>", html);
    }
}
