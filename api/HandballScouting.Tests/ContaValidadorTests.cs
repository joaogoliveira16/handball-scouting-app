using HandballScouting.Api;

namespace HandballScouting.Tests;

public class ContaValidadorTests
{
    private static RegistoRequest Pedido(
        string? nome = "Ana Silva", string? email = "ana@exemplo.pt", string? palavraPasse = "palavra-passe-boa-1", string? equipa = "Águias do Norte") =>
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
        Assert.Empty(ContaValidador.ValidarRegisto(Pedido(palavraPasse: "1234567a")));
    }

    [Fact]
    public void Palavra_passe_sem_letra_ou_sem_numero_ou_comum_e_recusada()
    {
        Assert.Contains(ContaValidador.ValidarRegisto(Pedido(palavraPasse: "12345678")), e => e.Contains("letra e um número"));
        Assert.Contains(ContaValidador.ValidarRegisto(Pedido(palavraPasse: "so-letras-aqui")), e => e.Contains("letra e um número"));
        Assert.Contains(ContaValidador.ValidarRegisto(Pedido(palavraPasse: "Password123")), e => e.Contains("comum"));
    }

    [Fact]
    public void Palavra_passe_demasiado_longa_ou_so_espacos_e_recusada()
    {
        Assert.Contains(ContaValidador.ValidarRegisto(Pedido(palavraPasse: new string('a', 129))), e => e.Contains("128"));
        Assert.Contains(ContaValidador.ValidarRegisto(Pedido(palavraPasse: "          ")), e => e.Contains("espaços"));
        Assert.Empty(ContaValidador.ValidarRegisto(Pedido(palavraPasse: new string('a', 127) + "1")));
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
    [InlineData("1234567a")]
    [InlineData("uma palavra-passe com 2 espaços")]
    [InlineData("palavra-passe-123")]
    [InlineData("çãõéíóú1")]
    [InlineData("Ábaco٣٤٥٦٧٨")]   // letra e dígito de outros alfabetos também contam
    public void Palavra_passe_boa_nao_tem_erro(string palavraPasse)
    {
        Assert.Null(ContaValidador.ErroPalavraPasse(palavraPasse));
    }

    [Theory]
    [InlineData(null, "pelo menos 8")]
    [InlineData("curta", "pelo menos 8")]
    [InlineData("1234567", "pelo menos 8")]
    [InlineData("        ", "só espaços")]
    [InlineData("12345678", "uma letra e um número")]
    [InlineData("abcdefghij", "uma letra e um número")]
    [InlineData("com espaços e sem número", "uma letra e um número")]
    [InlineData("!!!!????....", "uma letra e um número")]
    [InlineData("password123", "demasiado comum")]
    [InlineData("Password123", "demasiado comum")]
    [InlineData("BENFICA123", "demasiado comum")]
    public void Palavra_passe_ma_diz_o_que_falta(string? palavraPasse, string parte)
    {
        Assert.Contains(parte, ContaValidador.ErroPalavraPasse(palavraPasse));
    }

    [Fact]
    public void Palavra_passe_com_mais_de_128_caracteres_e_recusada()
    {
        Assert.Null(ContaValidador.ErroPalavraPasse(new string('a', 127) + "1"));
        Assert.Contains("128", ContaValidador.ErroPalavraPasse(new string('a', 128) + "1"));
    }

    [Theory]
    [InlineData("Ana")]
    [InlineData("  Ana Maria  ")]
    public void Nome_bom_nao_tem_erro(string nome)
    {
        Assert.Null(ContaValidador.ErroNome(nome));
    }

    [Theory]
    [InlineData(null, "obrigatório")]
    [InlineData("", "obrigatório")]
    [InlineData("   ", "obrigatório")]
    public void Nome_vazio_diz_que_e_obrigatorio(string? nome, string parte)
    {
        Assert.Contains(parte, ContaValidador.ErroNome(nome));
    }

    [Fact]
    public void Nome_com_mais_de_80_caracteres_e_recusado()
    {
        Assert.Null(ContaValidador.ErroNome(" " + new string('a', 80) + " "));
        Assert.Contains("80", ContaValidador.ErroNome(new string('a', 81)));
    }

    [Theory]
    [InlineData("ana@exemplo.pt")]
    [InlineData("  ANA@Exemplo.PT ")]
    public void Email_bom_nao_tem_erro(string email)
    {
        Assert.Null(ContaValidador.ErroEmail(email));
    }

    [Theory]
    [InlineData(null, "obrigatório")]
    [InlineData("  ", "obrigatório")]
    [InlineData("ana", "não é válido")]
    [InlineData("ana@exemplo", "não é válido")]
    [InlineData("ana @exemplo.pt", "não é válido")]
    public void Email_mau_diz_o_que_esta_mal(string? email, string parte)
    {
        Assert.Contains(parte, ContaValidador.ErroEmail(email));
    }
}
