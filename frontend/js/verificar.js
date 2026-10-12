// Página aberta a partir do link do email: confirma a conta e manda a pessoa entrar.
import { enviar } from './api.js';

const token = new URLSearchParams(location.search).get('t');
const seccoes = {
  confirmar: document.getElementById('a-confirmar'),
  confirmado: document.getElementById('confirmado'),
  falhou: document.getElementById('falhou'),
};

function mostrar(qual) {
  for (const [nome, el] of Object.entries(seccoes)) el.hidden = nome !== qual;
  document.title = `${{ confirmar: 'A confirmar', confirmado: 'Email confirmado', falhou: 'Confirmar email' }[qual]} · Scouting de Andebol`;
}

/** Depois de usado (ou recusado), o código já não serve para nada: sai do endereço e do histórico. */
function limparEndereco() {
  try { history.replaceState(null, '', location.pathname); } catch { /* sem history: fica como está */ }
}

function falhou(mensagem) {
  document.getElementById('erro-confirmar').textContent = mensagem;
  mostrar('falhou');
  document.getElementById('novo-email').focus();
}

// Novo link, se este expirou ou já não existe
document.getElementById('form-novo-link').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const erro = document.getElementById('erro-novo-link');
  const ok = document.getElementById('ok-novo-link');
  const botao = document.getElementById('botao-novo-link');
  const email = document.getElementById('novo-email').value.trim();
  erro.textContent = '';
  ok.hidden = true;
  if (!email) { erro.textContent = 'Escreve o email da conta.'; return; }
  botao.disabled = true;
  try {
    await enviar('POST', '/api/conta/reenviar-confirmacao', { email });
    ok.textContent = 'Se a conta existir e ainda não estiver confirmada, enviámos-lhe um link novo.';
    ok.hidden = false;
  } catch (falha) {
    erro.textContent = falha.message;
  } finally {
    botao.disabled = false;
  }
});

if (!token) {
  falhou('Falta o código no endereço. Abre o link do email outra vez, ou pede um novo.');
} else {
  mostrar('confirmar');
  try {
    await enviar('POST', '/api/conta/confirmar-email', { token });
    limparEndereco();
    mostrar('confirmado');
    document.getElementById('ir-entrar').focus();
  } catch (erro) {
    if (erro.status === 400) limparEndereco();   // 400 = código desconhecido ou expirado; outros erros (rede) deixam tentar de novo
    falhou(erro.status === 400 ? erro.message : 'Não foi possível falar com o servidor. Tenta recarregar a página.');
  }
}
