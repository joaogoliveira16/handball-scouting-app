using HandballScouting.Api;

namespace HandballScouting.Tests;

public class ContaValidadorTests
{
    private static RegistoRequest Pedido(string? nome = "Ana Silva", string? email = "ana@exemplo.pt", string? palavraPasse = "palavra-passe-boa") =>
        new(nome, email, palavraPasse);

    [Fact]
    public void Registo_correto_e_valido()
    {
        Assert.Empty(ContaValidador.ValidarRegisto(Pedido()));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Nome_vazio_e_invalido(string nome)
    {
        Assert.Contains(ContaValidador.ValidarRegisto(Pedido(nome: nome)), e => e.Contains("nome"));
    }

    [Fact]
    public void Nome_nulo_ou_demasiado_longo_e_invalido()
    {
        Assert.Contains(ContaValidador.ValidarRegisto(Pedido(nome: null)), e => e.Contains("nome"));
        Assert.Contains(ContaValidador.ValidarRegisto(Pedido(nome: new string('a', 81))), e => e.Contains("80"));
        Assert.Empty(ContaValidador.ValidarRegisto(Pedido(nome: new string('a', 80))));
    }

    [Theory]
    [InlineData("")]
    [InlineData("sem-arroba")]
    [InlineData("a@b")]
    [InlineData("@exemplo.pt")]
    [InlineData("ana@")]
    [InlineData("ana @exemplo.pt")]
    [InlineData("ana@@exemplo.pt")]
    [InlineData("ana@exemplo .pt")]
    public void Email_invalido_e_recusado(string email)
    {
        Assert.Contains(ContaValidador.ValidarRegisto(Pedido(email: email)), e => e.Contains("email"));
    }

    [Fact]
    public void Email_demasiado_longo_ou_nulo_e_recusado()
    {
        Assert.Contains(ContaValidador.ValidarRegisto(Pedido(email: new string('a', 150) + "@exemplo.pt")), e => e.Contains("email"));
        Assert.Contains(ContaValidador.ValidarRegisto(Pedido(email: null)), e => e.Contains("email"));
    }

    [Fact]
    public void Email_e_normalizado_para_minusculas_sem_espacos()
    {
        Assert.Equal("ana.silva@exemplo.pt", ContaValidador.NormalizarEmail("  Ana.Silva@Exemplo.PT "));
        Assert.Equal("", ContaValidador.NormalizarEmail(null));
        Assert.Empty(ContaValidador.ValidarRegisto(Pedido(email: " ANA@Exemplo.pt ")));
    }

    [Fact]
    public void Palavra_passe_curta_e_recusada()
    {
        Assert.Contains(ContaValidador.ValidarRegisto(Pedido(palavraPasse: "1234567")), e => e.Contains("8"));
        Assert.Contains(ContaValidador.ValidarRegisto(Pedido(palavraPasse: null)), e => e.Contains("8"));
        Assert.Empty(ContaValidador.ValidarRegisto(Pedido(palavraPasse: "12345678")));
    }

    [Fact]
    public void Palavra_passe_demasiado_longa_ou_so_espacos_e_recusada()
    {
        Assert.Contains(ContaValidador.ValidarRegisto(Pedido(palavraPasse: new string('a', 129))), e => e.Contains("128"));
        Assert.Contains(ContaValidador.ValidarRegisto(Pedido(palavraPasse: "          ")), e => e.Contains("espaços"));
        Assert.Empty(ContaValidador.ValidarRegisto(Pedido(palavraPasse: new string('a', 128))));
    }

    [Fact]
    public void Varios_erros_aparecem_todos_de_uma_vez()
    {
        var erros = ContaValidador.ValidarRegisto(new RegistoRequest("", "x", "1"));
        Assert.True(erros.Count == 3, $"esperava 3 erros e houve {erros.Count}");
    }
}
