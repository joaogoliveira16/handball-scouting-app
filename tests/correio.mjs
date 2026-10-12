// Cliente da caixa de correio de teste (Mailpit). Nos testes, a API envia os emails de confirmação por SMTP para o
// Mailpit (no CI e no docker compose) e daqui lê-se o que chegou, tal como uma pessoa o faria na interface web.
//   EMAIL_API=http://localhost:8025   (por omissão)
const EMAIL_API = process.env.EMAIL_API ?? 'http://localhost:8025';

async function pedir(caminho) {
  const resposta = await fetch(EMAIL_API + caminho);
  if (!resposta.ok) throw new Error(`Caixa de correio de teste: ${caminho} respondeu ${resposta.status}`);
  return resposta.json();
}

/** Mensagens enviadas para este endereço, a mais recente primeiro. */
export async function mensagensPara(email) {
  const { messages = [] } = await pedir('/api/v1/messages?limit=500');
  const alvo = email.toLowerCase();
  return messages.filter((m) => (m.To ?? []).some((a) => String(a.Address).toLowerCase() === alvo));
}

/** Espera até haver pelo menos `quantas` mensagens para este endereço. Devolve as que houver (pode ser menos, se esgotar o tempo). */
export async function esperarMensagens(email, quantas = 1, ms = 15000) {
  const limite = Date.now() + ms;
  let mensagens = await mensagensPara(email);
  while (mensagens.length < quantas && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 200));
    mensagens = await mensagensPara(email);
  }
  return mensagens;
}

/** A mensagem inteira (Text, HTML, Subject, From...). */
export const lerMensagem = (id) => pedir(`/api/v1/message/${id}`);

/** O código que vai no link «verificar.html?t=...» do email. */
export function tokenDe(texto) {
  return /verificar\.html\?t=([0-9a-f]{64})/.exec(texto ?? '')?.[1] ?? null;
}

/** O código do email mais recente enviado para este endereço (espera `quantas` mensagens). */
export async function ultimoToken(email, quantas = 1) {
  const [maisRecente] = await esperarMensagens(email, quantas);
  return maisRecente ? tokenDe((await lerMensagem(maisRecente.ID)).Text) : null;
}
