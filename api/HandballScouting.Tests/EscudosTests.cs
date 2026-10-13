using System.Text;
using HandballScouting.Api;
using Xunit;

namespace HandballScouting.Tests;

public class EscudosTests
{
    private static readonly byte[] CabecalhoPng = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0 };
    private static readonly byte[] CabecalhoJpeg = { 0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10 };

    private static byte[] Webp() => Encoding.ASCII.GetBytes("RIFF").Concat(new byte[] { 0x24, 0, 0, 0 }).Concat(Encoding.ASCII.GetBytes("WEBPVP8 ")).ToArray();

    /// <summary>Uma imagem do tamanho pedido (cabeçalho PNG e o resto a zeros).</summary>
    private static byte[] PngDe(int bytes) => CabecalhoPng.Concat(new byte[bytes - CabecalhoPng.Length]).ToArray();

    [Fact]
    public void O_limite_sao_200_KB()
    {
        Assert.Equal(200 * 1024, Escudos.MaxBytes);
    }

    [Fact]
    public void Reconhece_png_jpeg_e_webp_pelos_primeiros_bytes()
    {
        Assert.Equal(Escudos.Png, Escudos.DetetarTipo(CabecalhoPng));
        Assert.Equal(Escudos.Jpeg, Escudos.DetetarTipo(CabecalhoJpeg));
        Assert.Equal(Escudos.Webp, Escudos.DetetarTipo(Webp()));
    }

    [Theory]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>")]
    [InlineData("<?xml version=\"1.0\"?><svg/>")]
    [InlineData("GIF89a")]
    [InlineData("<html><body>não sou uma imagem</body></html>")]
    [InlineData("RIFF....WAVE")]
    public void Outros_formatos_nao_sao_aceites(string conteudo)
    {
        var (tipo, erro, status) = Escudos.Validar(Encoding.UTF8.GetBytes(conteudo));
        Assert.Null(tipo);
        Assert.Contains("PNG, JPEG ou WebP", erro);
        Assert.Equal(400, status);
    }

    [Fact]
    public void Um_png_curto_demais_para_ter_cabecalho_nao_e_aceite()
    {
        Assert.Null(Escudos.DetetarTipo(new byte[] { 0x89, 0x50, 0x4E }));
        Assert.Null(Escudos.DetetarTipo(new byte[] { 0xFF, 0xD8 }));
        Assert.Null(Escudos.DetetarTipo(Array.Empty<byte>()));
    }

    [Fact]
    public void Imagem_vazia_e_recusada()
    {
        var (tipo, erro, status) = Escudos.Validar(Array.Empty<byte>());
        Assert.Null(tipo);
        Assert.Contains("Falta a imagem", erro);
        Assert.Equal(400, status);
    }

    [Fact]
    public void Ate_200_KB_cabe_e_um_byte_a_mais_nao()
    {
        var (tipo, erro, status) = Escudos.Validar(PngDe(Escudos.MaxBytes));
        Assert.Equal(Escudos.Png, tipo);
        Assert.Null(erro);
        Assert.Equal(200, status);

        var (tipoGrande, erroGrande, statusGrande) = Escudos.Validar(PngDe(Escudos.MaxBytes + 1));
        Assert.Null(tipoGrande);
        Assert.Contains("200 KB", erroGrande);
        Assert.Equal(413, statusGrande);
    }
}
