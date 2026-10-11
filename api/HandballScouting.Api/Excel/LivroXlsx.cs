using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Xml;

namespace HandballScouting.Api.Excel;

/// <summary>Estilos disponíveis para as células (ver styles.xml gerado em <see cref="LivroXlsx"/>).</summary>
public enum EstiloCelula
{
    Normal = 0,
    Titulo = 1,
    Cabecalho = 2,
    Negrito = 3,
    Decimal = 4,   // 0.0
    Inteiro = 5    // 0
}

/// <summary>
/// Valor de uma célula: texto, número (int, long, decimal, double...), booleano ou null (célula vazia).
/// O texto é sempre gravado como texto, nunca como fórmula.
/// </summary>
public readonly record struct Celula(object? Valor, EstiloCelula Estilo = EstiloCelula.Normal)
{
    public static Celula Vazia => new(null);
    public static Celula Texto(string? texto, EstiloCelula estilo = EstiloCelula.Normal) => new(texto, estilo);
    public static Celula Numero(long valor) => new(valor, EstiloCelula.Inteiro);
    public static Celula Numero(decimal? valor) => new(valor, EstiloCelula.Decimal);
    public static Celula Cabecalho(string texto) => new(texto, EstiloCelula.Cabecalho);
    public static Celula Titulo(string texto) => new(texto, EstiloCelula.Titulo);
    public static Celula Negrito(string texto) => new(texto, EstiloCelula.Negrito);
}

/// <summary>Uma folha do livro: linhas de células, mais algumas opções de apresentação.</summary>
public class FolhaXlsx(string nome)
{
    public string Nome { get; } = nome;
    public List<List<Celula>> Linhas { get; } = new();

    /// <summary>Número de linhas fixas no topo (0 = nenhuma). 1 = só a linha de cabeçalho.</summary>
    public int CongelarLinhas { get; set; }

    /// <summary>Se verdadeiro, põe filtros na linha de cabeçalho (1.ª linha) de uma tabela que ocupa a folha toda.</summary>
    public bool FiltroNoCabecalho { get; set; }

    public FolhaXlsx Adicionar(params Celula[] celulas)
    {
        Linhas.Add(celulas.ToList());
        return this;
    }

    public FolhaXlsx LinhaVazia()
    {
        Linhas.Add(new List<Celula>());
        return this;
    }
}

/// <summary>
/// Escritor mínimo de ficheiros Excel (.xlsx = ficheiro ZIP com XML, norma Office Open XML).
/// Não precisa de bibliotecas externas. Suporta várias folhas, texto, números, cabeçalhos estilizados,
/// larguras de coluna automáticas, primeira linha fixa e filtros.
/// </summary>
public static class LivroXlsx
{
    public const string TipoMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    private const string NsMain = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private const string NsRel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private const string NsPkgRel = "http://schemas.openxmlformats.org/package/2006/relationships";
    private const int MaxLinhas = 1_048_576;
    private const int MaxColunas = 16_384;

    private static readonly XmlWriterSettings Definicoes = new()
    {
        Encoding = new UTF8Encoding(false),
        Indent = false,
        CheckCharacters = false // os caracteres inválidos são retirados em Limpar()
    };

    public static byte[] Gerar(IReadOnlyList<FolhaXlsx> folhas)
    {
        if (folhas.Count == 0) throw new ArgumentException("O livro tem de ter pelo menos uma folha.", nameof(folhas));

        var nomes = NomesDasFolhas(folhas);

        using var memoria = new MemoryStream();
        using (var zip = new ZipArchive(memoria, ZipArchiveMode.Create, leaveOpen: true))
        {
            Escrever(zip, "[Content_Types].xml", w => ContentTypes(w, folhas.Count));
            Escrever(zip, "_rels/.rels", EscreverRelacoesRaiz);
            Escrever(zip, "xl/workbook.xml", w => Workbook(w, nomes));
            Escrever(zip, "xl/_rels/workbook.xml.rels", w => RelacoesWorkbook(w, folhas.Count));
            Escrever(zip, "xl/styles.xml", Estilos);
            for (var i = 0; i < folhas.Count; i++)
            {
                var folha = folhas[i];
                var indice = i;
                Escrever(zip, $"xl/worksheets/sheet{i + 1}.xml", w => Worksheet(w, folha, indice == 0));
            }
        }
        return memoria.ToArray();
    }

    // ------------------------- Utilitários -------------------------

    /// <summary>Nome de coluna do Excel: 0 → A, 25 → Z, 26 → AA...</summary>
    public static string NomeColuna(int indice)
    {
        if (indice < 0 || indice >= MaxColunas) throw new ArgumentOutOfRangeException(nameof(indice));
        var texto = "";
        for (var n = indice + 1; n > 0; n = (n - 1) / 26)
            texto = (char)('A' + (n - 1) % 26) + texto;
        return texto;
    }

    /// <summary>Nome de folha válido: até 31 caracteres, sem \ / ? * [ ] : nem apóstrofos nas pontas.</summary>
    public static string NomeValido(string? nome)
    {
        var limpo = new string((nome ?? "").Where(c => !"\\/?*[]:".Contains(c) && !char.IsControl(c)).ToArray())
            .Trim().Trim('\'');
        if (limpo.Length > 31) limpo = limpo[..31].TrimEnd().TrimEnd('\'');
        return limpo.Length == 0 ? "Folha" : limpo;
    }

    private static List<string> NomesDasFolhas(IReadOnlyList<FolhaXlsx> folhas)
    {
        var usados = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var nomes = new List<string>();
        foreach (var folha in folhas)
        {
            var base_ = NomeValido(folha.Nome);
            var nome = base_;
            for (var n = 2; !usados.Add(nome); n++)
            {
                var sufixo = $" ({n})";
                nome = (base_.Length + sufixo.Length > 31 ? base_[..(31 - sufixo.Length)] : base_) + sufixo;
            }
            nomes.Add(nome);
        }
        return nomes;
    }

    /// <summary>Retira os caracteres que o XML 1.0 não permite (por exemplo, controlos como \u0001).</summary>
    private static string Limpar(string texto)
    {
        StringBuilder? sb = null;
        for (var i = 0; i < texto.Length; i++)
        {
            var c = texto[i];
            var valido = c == '\t' || c == '\n' || c == '\r'
                         || (c >= 0x20 && c <= 0xD7FF)
                         || (c >= 0xE000 && c <= 0xFFFD)
                         || (char.IsHighSurrogate(c) && i + 1 < texto.Length && char.IsLowSurrogate(texto[i + 1]))
                         || (char.IsLowSurrogate(c) && i > 0 && char.IsHighSurrogate(texto[i - 1]));
            if (!valido && sb is null) sb = new StringBuilder(texto, 0, i, texto.Length);
            if (valido) sb?.Append(c);
        }
        return sb?.ToString() ?? texto;
    }

    private static string Numero(object valor) => valor switch
    {
        double d when double.IsNaN(d) || double.IsInfinity(d) => "0",
        float f when float.IsNaN(f) || float.IsInfinity(f) => "0",
        // decimal guarda a escala (100.0m), por isso escreve-se sem zeros finais: 100.0 -> 100, 66.70 -> 66.7
        decimal d => d.ToString("0.#############################", CultureInfo.InvariantCulture),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => Convert.ToString(valor, CultureInfo.InvariantCulture) ?? "0"
    };

    private static bool ENumero(object valor) =>
        valor is sbyte or byte or short or ushort or int or uint or long or ulong or float or double or decimal;

    private static void Escrever(ZipArchive zip, string caminho, Action<XmlWriter> conteudo)
    {
        var entrada = zip.CreateEntry(caminho, CompressionLevel.Optimal);
        using var fluxo = entrada.Open();
        using var w = XmlWriter.Create(fluxo, Definicoes);
        w.WriteStartDocument(standalone: true);
        conteudo(w);
        w.WriteEndDocument();
    }

    // ------------------------- Partes do pacote -------------------------

    private static void ContentTypes(XmlWriter w, int folhas)
    {
        const string ns = "http://schemas.openxmlformats.org/package/2006/content-types";
        w.WriteStartElement("Types", ns);
        Default(w, "rels", "application/vnd.openxmlformats-package.relationships+xml");
        Default(w, "xml", "application/xml");
        Override(w, "/xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml");
        Override(w, "/xl/styles.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml");
        for (var i = 1; i <= folhas; i++)
            Override(w, $"/xl/worksheets/sheet{i}.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml");
        w.WriteEndElement();

        static void Default(XmlWriter w, string extensao, string tipo)
        {
            w.WriteStartElement("Default");
            w.WriteAttributeString("Extension", extensao);
            w.WriteAttributeString("ContentType", tipo);
            w.WriteEndElement();
        }

        static void Override(XmlWriter w, string parte, string tipo)
        {
            w.WriteStartElement("Override");
            w.WriteAttributeString("PartName", parte);
            w.WriteAttributeString("ContentType", tipo);
            w.WriteEndElement();
        }
    }

    private static void EscreverRelacoesRaiz(XmlWriter w)
    {
        w.WriteStartElement("Relationships", NsPkgRel);
        Relacao(w, "rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "xl/workbook.xml");
        w.WriteEndElement();
    }

    private static void RelacoesWorkbook(XmlWriter w, int folhas)
    {
        w.WriteStartElement("Relationships", NsPkgRel);
        for (var i = 1; i <= folhas; i++)
            Relacao(w, $"rId{i}", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet", $"worksheets/sheet{i}.xml");
        Relacao(w, $"rId{folhas + 1}", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", "styles.xml");
        w.WriteEndElement();
    }

    private static void Relacao(XmlWriter w, string id, string tipo, string destino)
    {
        w.WriteStartElement("Relationship");
        w.WriteAttributeString("Id", id);
        w.WriteAttributeString("Type", tipo);
        w.WriteAttributeString("Target", destino);
        w.WriteEndElement();
    }

    private static void Workbook(XmlWriter w, List<string> nomes)
    {
        w.WriteStartElement("workbook", NsMain);
        w.WriteAttributeString("xmlns", "r", null, NsRel);
        w.WriteStartElement("sheets");
        for (var i = 0; i < nomes.Count; i++)
        {
            w.WriteStartElement("sheet");
            w.WriteAttributeString("name", Limpar(nomes[i]));
            w.WriteAttributeString("sheetId", (i + 1).ToString(CultureInfo.InvariantCulture));
            w.WriteAttributeString("id", NsRel, $"rId{i + 1}");
            w.WriteEndElement();
        }
        w.WriteEndElement();
        w.WriteEndElement();
    }

    /// <summary>
    /// Os estilos têm de seguir a ordem do enum <see cref="EstiloCelula"/>:
    /// 0 normal, 1 título, 2 cabeçalho, 3 negrito, 4 decimal (0.0), 5 inteiro (0).
    /// </summary>
    private static void Estilos(XmlWriter w)
    {
        w.WriteStartElement("styleSheet", NsMain);

        w.WriteStartElement("numFmts");
        w.WriteAttributeString("count", "1");
        w.WriteStartElement("numFmt");
        w.WriteAttributeString("numFmtId", "164");
        w.WriteAttributeString("formatCode", "0.0");
        w.WriteEndElement();
        w.WriteEndElement();

        // 0 normal, 1 negrito, 2 negrito branco, 3 negrito grande
        w.WriteStartElement("fonts");
        w.WriteAttributeString("count", "4");
        Fonte(w, negrito: false, tamanho: 11, cor: null);
        Fonte(w, negrito: true, tamanho: 11, cor: null);
        Fonte(w, negrito: true, tamanho: 11, cor: "FFFFFFFF");
        Fonte(w, negrito: true, tamanho: 14, cor: null);
        w.WriteEndElement();

        // 0 e 1 são obrigatórios (nenhum e gray125); 2 = azul-escuro dos cabeçalhos
        w.WriteStartElement("fills");
        w.WriteAttributeString("count", "3");
        PreencherPadrao(w, "none", null);
        PreencherPadrao(w, "gray125", null);
        PreencherPadrao(w, "solid", "FF1F2A44");
        w.WriteEndElement();

        w.WriteStartElement("borders");
        w.WriteAttributeString("count", "1");
        w.WriteStartElement("border");
        w.WriteElementString("left", null);
        w.WriteElementString("right", null);
        w.WriteElementString("top", null);
        w.WriteElementString("bottom", null);
        w.WriteElementString("diagonal", null);
        w.WriteEndElement();
        w.WriteEndElement();

        w.WriteStartElement("cellStyleXfs");
        w.WriteAttributeString("count", "1");
        w.WriteStartElement("xf");
        w.WriteAttributeString("numFmtId", "0");
        w.WriteAttributeString("fontId", "0");
        w.WriteAttributeString("fillId", "0");
        w.WriteAttributeString("borderId", "0");
        w.WriteEndElement();
        w.WriteEndElement();

        w.WriteStartElement("cellXfs");
        w.WriteAttributeString("count", "6");
        Formato(w, numFmt: 0, fonte: 0, preenchimento: 0);                                  // normal
        Formato(w, numFmt: 0, fonte: 3, preenchimento: 0);                                  // título
        Formato(w, numFmt: 0, fonte: 2, preenchimento: 2, alinhamento: "center");           // cabeçalho
        Formato(w, numFmt: 0, fonte: 1, preenchimento: 0);                                  // negrito
        Formato(w, numFmt: 164, fonte: 0, preenchimento: 0);                                // 0.0
        Formato(w, numFmt: 1, fonte: 0, preenchimento: 0);                                  // 0
        w.WriteEndElement();

        w.WriteStartElement("cellStyles");
        w.WriteAttributeString("count", "1");
        w.WriteStartElement("cellStyle");
        w.WriteAttributeString("name", "Normal");
        w.WriteAttributeString("xfId", "0");
        w.WriteAttributeString("builtinId", "0");
        w.WriteEndElement();
        w.WriteEndElement();

        w.WriteEndElement();

        static void Fonte(XmlWriter w, bool negrito, int tamanho, string? cor)
        {
            w.WriteStartElement("font");
            if (negrito) w.WriteElementString("b", null);
            w.WriteStartElement("sz");
            w.WriteAttributeString("val", tamanho.ToString(CultureInfo.InvariantCulture));
            w.WriteEndElement();
            w.WriteStartElement("color");
            if (cor is null) w.WriteAttributeString("theme", "1");
            else w.WriteAttributeString("rgb", cor);
            w.WriteEndElement();
            w.WriteStartElement("name");
            w.WriteAttributeString("val", "Calibri");
            w.WriteEndElement();
            w.WriteStartElement("family");
            w.WriteAttributeString("val", "2");
            w.WriteEndElement();
            w.WriteEndElement();
        }

        static void PreencherPadrao(XmlWriter w, string padrao, string? cor)
        {
            w.WriteStartElement("fill");
            w.WriteStartElement("patternFill");
            w.WriteAttributeString("patternType", padrao);
            if (cor is not null)
            {
                w.WriteStartElement("fgColor");
                w.WriteAttributeString("rgb", cor);
                w.WriteEndElement();
                w.WriteStartElement("bgColor");
                w.WriteAttributeString("indexed", "64");
                w.WriteEndElement();
            }
            w.WriteEndElement();
            w.WriteEndElement();
        }

        static void Formato(XmlWriter w, int numFmt, int fonte, int preenchimento, string? alinhamento = null)
        {
            w.WriteStartElement("xf");
            w.WriteAttributeString("numFmtId", numFmt.ToString(CultureInfo.InvariantCulture));
            w.WriteAttributeString("fontId", fonte.ToString(CultureInfo.InvariantCulture));
            w.WriteAttributeString("fillId", preenchimento.ToString(CultureInfo.InvariantCulture));
            w.WriteAttributeString("borderId", "0");
            w.WriteAttributeString("xfId", "0");
            if (numFmt != 0) w.WriteAttributeString("applyNumberFormat", "1");
            if (fonte != 0) w.WriteAttributeString("applyFont", "1");
            if (preenchimento != 0) w.WriteAttributeString("applyFill", "1");
            if (alinhamento is not null)
            {
                w.WriteAttributeString("applyAlignment", "1");
                w.WriteStartElement("alignment");
                w.WriteAttributeString("horizontal", alinhamento);
                w.WriteAttributeString("vertical", "center");
                w.WriteAttributeString("wrapText", "1");
                w.WriteEndElement();
            }
            w.WriteEndElement();
        }
    }

    private static void Worksheet(XmlWriter w, FolhaXlsx folha, bool selecionada)
    {
        if (folha.Linhas.Count > MaxLinhas)
            throw new InvalidOperationException($"A folha \"{folha.Nome}\" tem mais linhas do que o Excel permite.");

        var colunas = folha.Linhas.Count == 0 ? 0 : folha.Linhas.Max(l => l.Count);
        if (colunas > MaxColunas)
            throw new InvalidOperationException($"A folha \"{folha.Nome}\" tem mais colunas do que o Excel permite.");

        w.WriteStartElement("worksheet", NsMain);

        // Ordem dos elementos definida pela norma: dimension, sheetViews, sheetFormatPr, cols, sheetData, autoFilter
        if (folha.Linhas.Count > 0 && colunas > 0)
        {
            w.WriteStartElement("dimension");
            w.WriteAttributeString("ref", $"A1:{NomeColuna(colunas - 1)}{folha.Linhas.Count}");
            w.WriteEndElement();
        }

        w.WriteStartElement("sheetViews");
        w.WriteStartElement("sheetView");
        if (selecionada) w.WriteAttributeString("tabSelected", "1");
        w.WriteAttributeString("workbookViewId", "0");
        if (folha.CongelarLinhas > 0)
        {
            w.WriteStartElement("pane");
            w.WriteAttributeString("ySplit", folha.CongelarLinhas.ToString(CultureInfo.InvariantCulture));
            w.WriteAttributeString("topLeftCell", $"A{folha.CongelarLinhas + 1}");
            w.WriteAttributeString("activePane", "bottomLeft");
            w.WriteAttributeString("state", "frozen");
            w.WriteEndElement();
        }
        w.WriteEndElement();
        w.WriteEndElement();

        w.WriteStartElement("sheetFormatPr");
        w.WriteAttributeString("defaultRowHeight", "15");
        w.WriteEndElement();

        var larguras = LargurasDasColunas(folha, colunas);
        if (larguras.Length > 0)
        {
            w.WriteStartElement("cols");
            for (var c = 0; c < larguras.Length; c++)
            {
                w.WriteStartElement("col");
                w.WriteAttributeString("min", (c + 1).ToString(CultureInfo.InvariantCulture));
                w.WriteAttributeString("max", (c + 1).ToString(CultureInfo.InvariantCulture));
                w.WriteAttributeString("width", larguras[c].ToString("0.##", CultureInfo.InvariantCulture));
                w.WriteAttributeString("customWidth", "1");
                w.WriteEndElement();
            }
            w.WriteEndElement();
        }

        w.WriteStartElement("sheetData");
        for (var r = 0; r < folha.Linhas.Count; r++)
        {
            var linha = folha.Linhas[r];
            w.WriteStartElement("row");
            w.WriteAttributeString("r", (r + 1).ToString(CultureInfo.InvariantCulture));
            for (var c = 0; c < linha.Count; c++)
                EscreverCelula(w, linha[c], $"{NomeColuna(c)}{r + 1}");
            w.WriteEndElement();
        }
        w.WriteEndElement();

        if (folha.FiltroNoCabecalho && colunas > 0 && folha.Linhas.Count > 0)
        {
            w.WriteStartElement("autoFilter");
            w.WriteAttributeString("ref", $"A1:{NomeColuna(colunas - 1)}{folha.Linhas.Count}");
            w.WriteEndElement();
        }

        w.WriteEndElement();
    }

    private static void EscreverCelula(XmlWriter w, Celula celula, string referencia)
    {
        if (celula.Valor is null && celula.Estilo == EstiloCelula.Normal) return; // célula vazia sem estilo

        w.WriteStartElement("c");
        w.WriteAttributeString("r", referencia);
        if (celula.Estilo != EstiloCelula.Normal)
            w.WriteAttributeString("s", ((int)celula.Estilo).ToString(CultureInfo.InvariantCulture));

        switch (celula.Valor)
        {
            case null:
                break;
            case bool b:
                w.WriteAttributeString("t", "b");
                w.WriteElementString("v", b ? "1" : "0");
                break;
            case var n when ENumero(n):
                w.WriteElementString("v", Numero(n));
                break;
            default:
            {
                var texto = Limpar(Convert.ToString(celula.Valor, CultureInfo.InvariantCulture) ?? "");
                w.WriteAttributeString("t", "inlineStr");
                w.WriteStartElement("is");
                w.WriteStartElement("t");
                w.WriteAttributeString("xml", "space", null, "preserve");
                w.WriteString(texto);
                w.WriteEndElement();
                w.WriteEndElement();
                break;
            }
        }
        w.WriteEndElement();
    }

    /// <summary>Largura de cada coluna segundo o conteúdo mais largo (as linhas com uma só célula não contam).</summary>
    private static double[] LargurasDasColunas(FolhaXlsx folha, int colunas)
    {
        var larguras = new double[colunas];
        for (var c = 0; c < colunas; c++) larguras[c] = 8;

        foreach (var linha in folha.Linhas)
        {
            // Uma linha com uma só célula é um título/legenda: transborda para a direita e não alarga a coluna
            if (linha.Count(c => c.Valor is not null) <= 1) continue;

            for (var c = 0; c < linha.Count; c++)
            {
                var celula = linha[c];
                if (celula.Valor is null) continue;

                var texto = celula.Valor switch
                {
                    string s => s,
                    bool b => b ? "VERDADEIRO" : "FALSO",
                    var n when ENumero(n) => Numero(n),
                    var outro => Convert.ToString(outro, CultureInfo.InvariantCulture) ?? ""
                };
                // Texto com várias linhas: conta a mais comprida
                var comprimento = texto.Split('\n').Max(l => l.Length);
                // O negrito e os cabeçalhos ocupam um pouco mais
                var extra = celula.Estilo is EstiloCelula.Cabecalho or EstiloCelula.Negrito ? 3 : 2;
                larguras[c] = Math.Max(larguras[c], Math.Min(comprimento + extra, 60));
            }
        }
        return larguras;
    }
}
