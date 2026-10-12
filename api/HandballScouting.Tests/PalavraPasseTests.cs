using HandballScouting.Api;

namespace HandballScouting.Tests;

public class PalavraPasseTests
{
    [Fact]
    public void Hash_e_verificacao_da_mesma_palavra_passe()
    {
        var hash = PalavraPasse.Hash("uma palavra-passe longa");
        Assert.True(PalavraPasse.Verificar("uma palavra-passe longa", hash));
    }

    [Fact]
    public void Palavra_passe_errada_nao_passa()
    {
        var hash = PalavraPasse.Hash("certa-certa");
        Assert.False(PalavraPasse.Verificar("errada-errada", hash));
        Assert.False(PalavraPasse.Verificar("Certa-certa", hash));
        Assert.False(PalavraPasse.Verificar("", hash));
    }

    [Fact]
    public void O_hash_nao_contem_a_palavra_passe_e_leva_sal_diferente_de_cada_vez()
    {
        var a = PalavraPasse.Hash("mesma-palavra-passe");
        var b = PalavraPasse.Hash("mesma-palavra-passe");
        Assert.False(a == b);
        Assert.False(a.Contains("mesma-palavra-passe"));
        Assert.True(a.StartsWith("pbkdf2-sha256$600000$"));
        Assert.True(PalavraPasse.Verificar("mesma-palavra-passe", a));
        Assert.True(PalavraPasse.Verificar("mesma-palavra-passe", b));
    }

    [Theory]
    [InlineData("")]
    [InlineData("texto qualquer")]
    [InlineData("pbkdf2-sha256$600000$so-tres-partes")]
    [InlineData("pbkdf2-sha256$abc$AAAA$AAAA")]
    [InlineData("pbkdf2-sha256$0$AAAA$AAAA")]
    [InlineData("pbkdf2-sha256$1000$não é base64$AAAA")]
    [InlineData("pbkdf2-sha256$1000$AAAA$")]
    [InlineData("md5$1000$AAAA$AAAA")]
    public void Hash_estragado_nunca_passa_e_nao_lanca_excecao(string guardado)
    {
        Assert.False(PalavraPasse.Verificar("qualquer-coisa", guardado));
    }

    [Fact]
    public void Gastar_tempo_nao_falha()
    {
        PalavraPasse.GastarTempo("qualquer-coisa");
    }

    [Fact]
    public void Hash_do_token_e_um_sha256_em_hexadecimal()
    {
        // vetor de teste conhecido: SHA-256("abc")
        Assert.Equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", PalavraPasse.HashDoToken("abc"));
        Assert.Equal(64, PalavraPasse.HashDoToken("outro token").Length);
    }
}
