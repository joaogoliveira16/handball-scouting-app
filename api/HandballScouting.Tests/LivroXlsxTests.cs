using System.Globalization;
using System.IO.Compression;
using System.Xml.Linq;
using HandballScouting.Api.Excel;

namespace HandballScouting.Tests;

/// <summary>Leitor mínimo de .xlsx para os testes: devolve, por folha, as linhas como vetores de texto.</summary>
internal static class LeitorXlsx
{
    private static readonly XNamespace Ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

    public static ZipArchive Abrir(byte[] ficheiro) => new(new MemoryStream(ficheiro), ZipArchiveMode.Read);

    public static XDocument Xml(ZipArchive zip, string parte)
    {
        var entrada = zip.GetEntry(parte) ?? throw new InvalidOperationException($"falta a parte {parte}");
        using var fluxo = entrada.Open();
        return XDocument.Load(fluxo);
    }

    public static List<string> NomesDasFolhas(byte[] ficheiro)
    {
        using var zip = Abrir(ficheiro);
        return Xml(zip, "xl/workbook.xml").Descendants(Ns + "sheet").Select(s => (string)s.Attribute("name")!).ToList();
    }

    /// <summary>Linhas da folha: células vazias ficam como "".</summary>
    public static List<string[]> Linhas(byte[] ficheiro, string folha)
    {
        var indice = NomesDasFolhas(ficheiro).IndexOf(folha);
        if (indice < 0) throw new InvalidOperationException($"não existe a folha {folha}");

        using var zip = Abrir(ficheiro);
        var resultado = new List<string[]>();
        foreach (var linha in Xml(zip, $"xl/worksheets/sheet{indice + 1}.xml").Descendants(Ns + "row"))
        {
            var valores = new List<string>();
            foreach (var celula in linha.Elements(Ns + "c"))
            {
                var coluna = IndiceDaColuna((string)celula.Attribute("r")!);
                while (valores.Count < coluna) valores.Add("");
                var texto = celula.Element(Ns + "is")?.Element(Ns + "t")?.Value ?? celula.Element(Ns + "v")?.Value ?? "";
                valores.Add(texto);
            }
            resultado.Add(valores.ToArray());
        }
        return resultado;
    }

    private static int IndiceDaColuna(string referencia)
    {
        var n = 0;
        foreach (var ch in referencia.TakeWhile(char.IsLetter)) n = n * 26 + (ch - 'A' + 1);
        return n - 1;
    }
}

public class LivroXlsxTests
{
    private static readonly XNamespace Ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

    private static byte[] Livro(params FolhaXlsx[] folhas) => LivroXlsx.Gerar(folhas);

    [Theory]
    [InlineData(0, "A")]
    [InlineData(25, "Z")]
    [InlineData(26, "AA")]
    [InlineData(27, "AB")]
    [InlineData(701, "ZZ")]
    [InlineData(702, "AAA")]
    public void Nomes_das_colunas(int indice, string esperado)
    {
        Assert.Equal(esperado, LivroXlsx.NomeColuna(indice));
    }

    [Fact]
    public void Nome_de_folha_sem_caracteres_proibidos_e_com_31_no_maximo()
    {
        Assert.Equal("ab", LivroXlsx.NomeValido("a/b?*[]:\\"));
        Assert.Equal(31, LivroXlsx.NomeValido(new string('x', 50)).Length);
        Assert.Equal("Folha", LivroXlsx.NomeValido("   "));
        Assert.Equal("Folha", LivroXlsx.NomeValido(null));
    }

    [Fact]
    public void O_ficheiro_e_um_zip_com_as_partes_de_um_xlsx_e_todo_o_xml_e_valido()
    {
        var bytes = Livro(new FolhaXlsx("A").Adicionar(Celula.Texto("x")), new FolhaXlsx("B").Adicionar(Celula.Numero(1L)));

        Assert.Equal((byte)'P', bytes[0]);
        Assert.Equal((byte)'K', bytes[1]);

        using var zip = LeitorXlsx.Abrir(bytes);
        var partes = zip.Entries.Select(e => e.FullName).ToList();
        foreach (var esperada in new[]
                 {
                     "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels",
                     "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"
                 })
            Assert.Contains(partes, p => p == esperada);

        foreach (var parte in partes) LeitorXlsx.Xml(zip, parte); // lança exceção se não for XML bem formado
        Assert.Equal(new List<string> { "A", "B" }, LeitorXlsx.NomesDasFolhas(bytes));
    }

    [Fact]
    public void Folhas_com_o_mesmo_nome_ficam_com_nomes_diferentes()
    {
        var nomes = LeitorXlsx.NomesDasFolhas(Livro(new FolhaXlsx("Dados"), new FolhaXlsx("dados"), new FolhaXlsx("Dados")));
        Assert.Equal(3, nomes.Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.Equal("Dados", nomes[0]);
    }

    [Fact]
    public void Livro_sem_folhas_e_rejeitado()
    {
        Assert.Throws<ArgumentException>(() => LivroXlsx.Gerar(Array.Empty<FolhaXlsx>()));
    }

    [Fact]
    public void Texto_com_caracteres_especiais_e_guardado_tal_e_qual()
    {
        var texto = "Águias & \"Leões\" <3> 'x'";
        var linhas = LeitorXlsx.Linhas(Livro(new FolhaXlsx("T").Adicionar(Celula.Texto(texto))), "T");
        Assert.Equal(texto, linhas[0][0]);
    }

    [Fact]
    public void Caracteres_invalidos_em_xml_sao_retirados_sem_estragar_o_ficheiro()
    {
        var linhas = LeitorXlsx.Linhas(Livro(new FolhaXlsx("T").Adicionar(Celula.Texto("a\u0001b\u0000c"))), "T");
        Assert.Equal("abc", linhas[0][0]);
    }

    [Fact]
    public void Texto_que_parece_formula_fica_como_texto()
    {
        var bytes = Livro(new FolhaXlsx("T").Adicionar(Celula.Texto("=1+1"), Celula.Texto("@SUM(A1)")));
        using var zip = LeitorXlsx.Abrir(bytes);
        var folha = LeitorXlsx.Xml(zip, "xl/worksheets/sheet1.xml");

        Assert.Empty(folha.Descendants(Ns + "f"));
        Assert.Equal(2, folha.Descendants(Ns + "c").Count(c => (string?)c.Attribute("t") == "inlineStr"));
        Assert.Equal("=1+1", LeitorXlsx.Linhas(bytes, "T")[0][0]);
    }

    [Fact]
    public void Espacos_nas_pontas_do_texto_sao_preservados()
    {
        var linhas = LeitorXlsx.Linhas(Livro(new FolhaXlsx("T").Adicionar(Celula.Texto("  dois  "))), "T");
        Assert.Equal("  dois  ", linhas[0][0]);
    }

    [Fact]
    public void Numeros_sao_gravados_com_ponto_decimal_qualquer_que_seja_a_cultura()
    {
        var anterior = CultureInfo.CurrentCulture;
        try
        {
            try { CultureInfo.CurrentCulture = new CultureInfo("pt-PT"); }
            catch (CultureNotFoundException) { /* sistema sem dados de culturas: o resto do teste continua válido */ }

            var linhas = LeitorXlsx.Linhas(Livro(new FolhaXlsx("T").Adicionar(Celula.Numero(66.7m), Celula.Numero(12L))), "T");
            Assert.Equal("66.7", linhas[0][0]);
            Assert.Equal("12", linhas[0][1]);
        }
        finally
        {
            CultureInfo.CurrentCulture = anterior;
        }
    }

    [Fact]
    public void Numero_nulo_gera_celula_vazia()
    {
        var linhas = LeitorXlsx.Linhas(Livro(new FolhaXlsx("T").Adicionar(Celula.Texto("a"), Celula.Numero((decimal?)null), Celula.Texto("c"))), "T");
        Assert.Equal(3, linhas[0].Length);
        Assert.Equal("", linhas[0][1]);
        Assert.Equal("c", linhas[0][2]);
    }

    [Fact]
    public void Celulas_vazias_no_meio_mantem_as_colunas_certas()
    {
        var linhas = LeitorXlsx.Linhas(Livro(new FolhaXlsx("T").Adicionar(Celula.Texto("a"), Celula.Vazia, Celula.Vazia, Celula.Texto("d"))), "T");
        Assert.Equal("d", linhas[0][3]);
    }

    [Fact]
    public void Cabecalho_fixo_e_filtro_aparecem_na_folha()
    {
        var folha = new FolhaXlsx("T") { CongelarLinhas = 1, FiltroNoCabecalho = true };
        folha.Adicionar(Celula.Cabecalho("A"), Celula.Cabecalho("B"));
        folha.Adicionar(Celula.Texto("x"), Celula.Numero(1L));

        using var zip = LeitorXlsx.Abrir(Livro(folha));
        var xml = LeitorXlsx.Xml(zip, "xl/worksheets/sheet1.xml");

        var painel = xml.Descendants(Ns + "pane").Single();
        Assert.Equal("1", (string)painel.Attribute("ySplit")!);
        Assert.Equal("frozen", (string)painel.Attribute("state")!);
        Assert.Equal("A1:B2", (string)xml.Descendants(Ns + "autoFilter").Single().Attribute("ref")!);
    }

    [Fact]
    public void Sem_opcoes_nao_ha_painel_fixo_nem_filtro()
    {
        using var zip = LeitorXlsx.Abrir(Livro(new FolhaXlsx("T").Adicionar(Celula.Texto("x"))));
        var xml = LeitorXlsx.Xml(zip, "xl/worksheets/sheet1.xml");
        Assert.Empty(xml.Descendants(Ns + "pane"));
        Assert.Empty(xml.Descendants(Ns + "autoFilter"));
    }

    [Fact]
    public void A_largura_das_colunas_acompanha_o_texto_mais_comprido()
    {
        var folha = new FolhaXlsx("T");
        folha.Adicionar(Celula.Titulo(new string('t', 100))); // linhas com uma só célula transbordam e não alargam a coluna
        folha.Adicionar(Celula.Texto("curto"), Celula.Texto("b"));
        folha.Adicionar(Celula.Texto("um texto bastante mais comprido"), Celula.Texto("b"));

        using var zip = LeitorXlsx.Abrir(Livro(folha));
        var largura = double.Parse((string)LeitorXlsx.Xml(zip, "xl/worksheets/sheet1.xml").Descendants(Ns + "col").First().Attribute("width")!,
            CultureInfo.InvariantCulture);
        Assert.True(largura >= 32 && largura < 40, $"largura inesperada: {largura}");
    }

    [Fact]
    public void Os_estilos_do_enum_existem_no_ficheiro_de_estilos()
    {
        using var zip = LeitorXlsx.Abrir(Livro(new FolhaXlsx("T").Adicionar(Celula.Titulo("t"))));
        var estilos = LeitorXlsx.Xml(zip, "xl/styles.xml");
        var formatos = estilos.Descendants(Ns + "cellXfs").Single().Elements(Ns + "xf").Count();
        Assert.Equal(Enum.GetValues<EstiloCelula>().Length, formatos);
    }
}
