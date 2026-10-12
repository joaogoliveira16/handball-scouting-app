using System.Net;
using System.Net.Mail;
using System.Net.Mime;
using System.Text;

namespace HandballScouting.Api;

/// <summary>Envia um email (texto simples e HTML).</summary>
public interface IEnviadorEmail
{
    /// <summary>Lança uma exceção se o email não puder ser enviado.</summary>
    Task EnviarAsync(string para, string assunto, string texto, string html, CancellationToken ct = default);
}

/// <summary>Envio por SMTP (Gmail, Outlook, SendGrid, ... ou o Mailpit do docker-compose, que apanha tudo para teste).</summary>
public sealed class EnviadorSmtp(OpcoesEmail opcoes) : IEnviadorEmail
{
    public async Task EnviarAsync(string para, string assunto, string texto, string html, CancellationToken ct = default)
    {
        if (!opcoes.Configurado)
            throw new InvalidOperationException("O envio de emails não está configurado (falta Email__Host).");

        using var mensagem = new MailMessage
        {
            From = new MailAddress(opcoes.De, opcoes.NomeDe, Encoding.UTF8),
            Subject = assunto,
            SubjectEncoding = Encoding.UTF8,
            Body = texto,
            BodyEncoding = Encoding.UTF8,
            IsBodyHtml = false,
        };
        mensagem.To.Add(new MailAddress(para));
        mensagem.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(html, Encoding.UTF8, MediaTypeNames.Text.Html));

        using var cliente = new SmtpClient(opcoes.Host!, opcoes.Porta)
        {
            EnableSsl = opcoes.UsarSsl,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            Timeout = 15_000,
        };
        if (!string.IsNullOrEmpty(opcoes.Utilizador))
            cliente.Credentials = new NetworkCredential(opcoes.Utilizador, opcoes.Senha ?? "");

        await cliente.SendMailAsync(mensagem, ct);
    }
}
