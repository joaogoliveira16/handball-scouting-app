using HandballScouting.Api;

namespace HandballScouting.Tests;

public class CadastroValidadorTests
{
    private const int Casa = 1;
    private const int Fora = 2;

    private static JogadorBasico Jogador(int id, int equipaId, string posicao = "LE") =>
        new() { Id = id, EquipaId = equipaId, PosicaoCodigo = posicao };

    // ------------------------- Equipas -------------------------

    [Fact]
    public void Equipa_com_nome_e_valida()
    {
        Assert.Empty(CadastroValidador.ValidarEquipa(new NovaEquipaRequest("Águias do Norte")));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Equipa_sem_nome_e_invalida(string nome)
    {
        var erros = CadastroValidador.ValidarEquipa(new NovaEquipaRequest(nome));
        Assert.Contains(erros, e => e.Contains("nome"));
    }

    [Fact]
    public void Equipa_com_nome_null_e_invalida()
    {
        Assert.NotEmpty(CadastroValidador.ValidarEquipa(new NovaEquipaRequest(null)));
    }

    [Fact]
    public void Equipa_com_nome_demasiado_longo_e_invalida()
    {
        var erros = CadastroValidador.ValidarEquipa(new NovaEquipaRequest(new string('a', 81)));
        Assert.Contains(erros, e => e.Contains("80"));
    }

    // ------------------------- Jogadores -------------------------

    [Fact]
    public void Jogador_valido_nao_tem_erros()
    {
        Assert.Empty(CadastroValidador.ValidarJogador(new JogadorRequest(9, "Rui Costa", "LE")));
    }

    [Theory]
    [InlineData("GR")]
    [InlineData("PE")]
    [InlineData("LE")]
    [InlineData("CE")]
    [InlineData("LD")]
    [InlineData("PD")]
    [InlineData("PV")]
    [InlineData("UN")]
    public void Todas_as_posicoes_sao_aceites(string posicao)
    {
        Assert.Empty(CadastroValidador.ValidarJogador(new JogadorRequest(7, "Nome", posicao)));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-3)]
    [InlineData(100)]
    public void Numero_fora_do_intervalo_e_invalido(int numero)
    {
        var erros = CadastroValidador.ValidarJogador(new JogadorRequest(numero, "Nome", "LE"));
        Assert.Contains(erros, e => e.Contains("numero"));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(99)]
    public void Numeros_limite_sao_aceites(int numero)
    {
        Assert.Empty(CadastroValidador.ValidarJogador(new JogadorRequest(numero, "Nome", "LE")));
    }

    [Fact]
    public void Jogador_sem_nome_e_invalido()
    {
        var erros = CadastroValidador.ValidarJogador(new JogadorRequest(9, "  ", "LE"));
        Assert.Contains(erros, e => e.Contains("nome"));
    }

    [Fact]
    public void Jogador_com_nome_demasiado_longo_e_invalido()
    {
        var erros = CadastroValidador.ValidarJogador(new JogadorRequest(9, new string('x', 81), "LE"));
        Assert.Contains(erros, e => e.Contains("80"));
    }

    [Theory]
    [InlineData("XX")]
    [InlineData("le")]
    [InlineData("")]
    public void Posicao_desconhecida_e_invalida(string posicao)
    {
        var erros = CadastroValidador.ValidarJogador(new JogadorRequest(9, "Nome", posicao));
        Assert.Contains(erros, e => e.Contains("posicao"));
    }

    [Fact]
    public void Posicao_null_e_invalida()
    {
        var erros = CadastroValidador.ValidarJogador(new JogadorRequest(9, "Nome", null));
        Assert.Contains(erros, e => e.Contains("posicao"));
    }

    [Fact]
    public void Erros_de_varios_campos_aparecem_todos()
    {
        var erros = CadastroValidador.ValidarJogador(new JogadorRequest(0, "", "ZZ"));
        Assert.Contains(erros, e => e.Contains("numero"));
        Assert.Contains(erros, e => e.Contains("nome"));
        Assert.Contains(erros, e => e.Contains("posicao"));
    }

    // ------------------------- Jogos -------------------------

    [Fact]
    public void Jogo_entre_duas_equipas_diferentes_e_valido()
    {
        Assert.Empty(CadastroValidador.ValidarJogo(new NovoJogoRequest(1, 2, "Pavilhão Municipal", null)));
    }

    [Fact]
    public void Jogo_de_uma_equipa_contra_ela_propria_e_invalido()
    {
        var erros = CadastroValidador.ValidarJogo(new NovoJogoRequest(1, 1, null, null));
        Assert.Contains(erros, e => e.Contains("diferentes"));
    }

    [Fact]
    public void Local_demasiado_longo_e_invalido()
    {
        var erros = CadastroValidador.ValidarJogo(new NovoJogoRequest(1, 2, new string('l', 121), null));
        Assert.Contains(erros, e => e.Contains("local"));
    }

    // ------------------------- Convocatória -------------------------

    [Fact]
    public void Convocatoria_valida_nao_tem_erros()
    {
        var existentes = new[] { Jogador(1, Casa), Jogador(2, Casa), Jogador(9, Fora) };
        Assert.Empty(CadastroValidador.ValidarConvocatoria(new[] { 1, 2, 9 }, existentes, Casa, Fora));
    }

    [Fact]
    public void Convocatoria_vazia_e_valida()
    {
        Assert.Empty(CadastroValidador.ValidarConvocatoria(Array.Empty<int>(), Array.Empty<JogadorBasico>(), Casa, Fora));
    }

    [Fact]
    public void Jogador_inexistente_e_rejeitado()
    {
        var erros = CadastroValidador.ValidarConvocatoria(new[] { 1, 77 }, new[] { Jogador(1, Casa) }, Casa, Fora);
        Assert.Contains(erros, e => e.Contains("77") && e.Contains("não existe"));
    }

    [Fact]
    public void Jogador_de_outra_equipa_e_rejeitado()
    {
        var existentes = new[] { Jogador(1, Casa), Jogador(50, 3) };
        var erros = CadastroValidador.ValidarConvocatoria(new[] { 1, 50 }, existentes, Casa, Fora);
        Assert.Contains(erros, e => e.Contains("50") && e.Contains("não pertence"));
    }

    [Fact]
    public void Dezasseis_por_equipa_e_o_maximo_permitido()
    {
        var existentes = Enumerable.Range(1, 16).Select(i => Jogador(i, Casa))
            .Concat(Enumerable.Range(101, 16).Select(i => Jogador(i, Fora))).ToList();
        var ids = existentes.Select(j => j.Id).ToList();
        Assert.Empty(CadastroValidador.ValidarConvocatoria(ids, existentes, Casa, Fora));
    }

    [Fact]
    public void Dezassete_na_equipa_da_casa_e_rejeitado()
    {
        var existentes = Enumerable.Range(1, 17).Select(i => Jogador(i, Casa)).ToList();
        var erros = CadastroValidador.ValidarConvocatoria(existentes.Select(j => j.Id).ToList(), existentes, Casa, Fora);
        Assert.Contains(erros, e => e.Contains("16") && e.Contains("casa"));
    }

    [Fact]
    public void Dezassete_na_equipa_de_fora_e_rejeitado()
    {
        var existentes = Enumerable.Range(101, 17).Select(i => Jogador(i, Fora)).ToList();
        var erros = CadastroValidador.ValidarConvocatoria(existentes.Select(j => j.Id).ToList(), existentes, Casa, Fora);
        Assert.Contains(erros, e => e.Contains("16") && e.Contains("fora"));
    }

    [Fact]
    public void Ids_repetidos_so_contam_uma_vez()
    {
        var existentes = new[] { Jogador(1, Casa) };
        Assert.Empty(CadastroValidador.ValidarConvocatoria(new[] { 1, 1, 1 }, existentes, Casa, Fora, maximo: 1));
    }

    [Fact]
    public void O_maximo_e_configuravel()
    {
        var existentes = new[] { Jogador(1, Casa), Jogador(2, Casa), Jogador(3, Casa) };
        var erros = CadastroValidador.ValidarConvocatoria(new[] { 1, 2, 3 }, existentes, Casa, Fora, maximo: 2);
        Assert.Contains(erros, e => e.Contains("2") && e.Contains("casa"));
    }
}
