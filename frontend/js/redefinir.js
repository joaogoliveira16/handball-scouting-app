// Página aberta a partir do link do email de recuperação: escolhe a palavra-passe nova.
import { enviar } from './api.js';

const token = new URLSearchParams(location.search).get('t');
const CODIGO_LINK_INVALIDO = 'link_invalido';
const seccoes = {
  escolher: document.getElementById('escolher'),
  feito: document.getElementById('feito'),
  falhou: document.getElementById('falhou'),
};

function mostrar(qual) {
  for (const [nome, el] of Object.entries(seccoes)) el.hidden = nome !== qual;
  document.title = `${{ escolher: 'Palavra-passe nova', feito: 'Palavra-passe alterada', falhou: 'Ligação inválida' }[qual]} · Scouting de Andebol`;
}

/** Depois de usado (ou recusado), o código já não serve para nada: sai do endereço e do histórico. */
function limparEndereco() {
  try { history.replaceState(null, '', location.pathname); } catch { /* sem history: fica como está */ }
}

function falhou(mensagem) {
  document.getElementById('erro-link').textContent = mensagem;
  mostrar('falhou');
  document.getElementById('novo-email').focus();
}

// Mostrar / esconder a palavra-passe
const botaoVer = document.getElementById('ver-nova');
botaoVer.addEventListener('click', () => {
  const campo = document.getElementById('nova-senha');
  const mostrarTexto = campo.type === 'password';
  campo.type = mostrarTexto ? 'text' : 'password';
  botaoVer.textContent = mostrarTexto ? 'Esconder' : 'Mostrar';
  botaoVer.setAttribute('aria-pressed', String(mostrarTexto));
});

// Escolher a palavra-passe
document.getElementById('form-nova').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const erro = document.getElementById('erro-nova');
  const botao = document.getElementById('botao-nova');
  const senha = document.getElementById('nova-senha').value;
  erro.textContent = '';
  if (senha.length < 8) { erro.textContent = 'A palavra-passe tem de ter pelo menos 8 caracteres.'; return; }
  if (!senha.trim()) { erro.textContent = 'A palavra-passe não pode ter só espaços.'; return; }

  botao.disabled = true;
  try {
    await enviar('POST', '/api/conta/redefinir-palavra-passe', { token, palavraPasse: senha });
    limparEndereco();
    document.getElementById('form-nova').reset();
    mostrar('feito');
    document.getElementById('ir-entrar').focus();
  } catch (falha) {
    if (falha.codigo === CODIGO_LINK_INVALIDO) {
      limparEndereco();
      falhou(falha.message);
    } else {
      erro.textContent = falha.status ? falha.message : 'Não foi possível falar com o servidor. Tenta outra vez.';
    }
    botao.disabled = false;
  }
});

// Pedir um link novo, se este expirou, já foi usado ou nunca existiu
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
    await enviar('POST', '/api/conta/esqueci-palavra-passe', { email });
    ok.textContent = 'Se existir uma conta com este email, enviámos-lhe uma ligação nova.';
    ok.hidden = false;
  } catch (falha) {
    erro.textContent = falha.message;
  } finally {
    botao.disabled = false;
  }
});

if (!/^[0-9a-f]{64}$/.test(token ?? '')) {
  limparEndereco();
  falhou('Falta o código no endereço ou está incompleto. Abre a ligação do email outra vez, ou pede uma nova.');
} else {
  mostrar('escolher');
  document.getElementById('nova-senha').focus();
}
