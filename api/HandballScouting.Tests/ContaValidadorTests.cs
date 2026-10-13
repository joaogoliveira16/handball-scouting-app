using HandballScouting.Api;

namespace HandballScouting.Tests;

public class ContaValidadorTests
{
    private static RegistoRequest Pedido(
        string? nome = "Ana Silva", string? email = "ana@exemplo.pt", string? palavraPasse = "palavra-passe-boa", string? equipa = "Águias do Norte") =>
        new(nome, email, palavraPasse, equipa);

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

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("    ")]
    public void A_equipa_da_conta_e_obrigatoria(string? equipa)
    {
        Assert.Contains(ContaValidador.ValidarRegisto(Pedido(equipa: equipa)), e => e.Contains("equipa"));
    }

    [Fact]
    public void O_nome_da_equipa_tem_no_maximo_80_caracteres()
    {
        Assert.Contains(ContaValidador.ValidarRegisto(Pedido(equipa: new string('a', 81))), e => e.Contains("equipa") && e.Contains("80"));
        Assert.Empty(ContaValidador.ValidarRegisto(Pedido(equipa: " " + new string('a', 80) + " ")));   // os espaços das pontas não contam
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
        var erros = ContaValidador.ValidarRegisto(new RegistoRequest("", "x", "1", ""));
        Assert.True(erros.Count == 4, $"esperava 4 erros e houve {erros.Count}");
    }

    [Theory]
    [InlineData("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", true)]
    [InlineData("0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef", false)]   // só minúsculas
    [InlineData("0123456789abcdef", false)]
    [InlineData("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg", false)]
    [InlineData("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void O_codigo_do_link_tem_64_hexadecimais(string? token, bool esperado)
    {
        Assert.Equal(esperado, ContaValidador.TokenValido(token));
    }

    [Theory]
    [InlineData("12345678")]
    [InlineData("uma palavra-passe com espaços")]
    public void Palavra_passe_boa_nao_tem_erro(string palavraPasse)
    {
        Assert.Null(ContaValidador.ErroPalavraPasse(palavraPasse));
    }

    [Theory]
    [InlineData(null, "pelo menos 8")]
    [InlineData("curta", "pelo menos 8")]
    [InlineData("1234567", "pelo menos 8")]
    [InlineData("        ", "só espaços")]
    public void Palavra_passe_ma_diz_o_que_falta(string? palavraPasse, string parte)
    {
        Assert.Contains(parte, ContaValidador.ErroPalavraPasse(palavraPasse));
    }

    [Fact]
    public void Palavra_passe_com_mais_de_128_caracteres_e_recusada()
    {
        Assert.Null(ContaValidador.ErroPalavraPasse(new string('a', 128)));
        Assert.Contains("128", ContaValidador.ErroPalavraPasse(new string('a', 129)));
    }
}
