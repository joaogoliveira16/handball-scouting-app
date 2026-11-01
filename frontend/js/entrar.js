// Entrar e criar conta. Quem cria a conta recebe um email com um link e só entra depois de o abrir.
import { enviar } from './api.js';
import { obterConta } from './conta.js';
import { h } from './dom.js';

const params = new URLSearchParams(location.search);
const formEntrar = document.getElementById('form-entrar');
const formRegisto = document.getElementById('form-registo');
const abaEntrar = document.getElementById('aba-entrar');
const abaRegisto = document.getElementById('aba-registo');
const titulo = document.getElementById('titulo-caixa');
const subtitulo = document.getElementById('sub-caixa');
const entrada = document.getElementById('entrada');
const painelConfirmar = document.getElementById('painel-confirmar');
const textoConfirmar = document.getElementById('texto-confirmar');
const estadoConfirmar = document.getElementById('estado-confirmar');
const botaoReenviar = document.getElementById('reenviar');
const painelEsqueci = document.getElementById('painel-esqueci');

const REGEX_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CODIGO_POR_CONFIRMAR = 'email_por_confirmar';
const PAUSA_REENVIO = 30;   // segundos entre pedidos de novo email

/** Para onde ir depois de entrar: a página de onde veio (só ficheiros .html deste site) ou a lista de jogos. */
function destino() {
  const voltar = params.get('voltar');
  const valido = voltar && /^[a-z]+\.html(\?[\w=&%.\-]*)?$/.test(voltar) && !voltar.startsWith('entrar.html');
  return valido ? voltar : './';
}

function mostrar(modo, comFoco = true) {
  const registo = modo === 'registo';
  entrada.hidden = false;
  painelConfirmar.hidden = true;
  painelEsqueci.hidden = true;
  formEntrar.hidden = registo;
  formRegisto.hidden = !registo;
  for (const [aba, ativa] of [[abaEntrar, !registo], [abaRegisto, registo]]) {
    aba.classList.toggle('ativo', ativa);
    aba.setAttribute('aria-selected', String(ativa));
  }
  titulo.textContent = registo ? 'Cria a tua conta' : 'Bem-vindo de volta';
  subtitulo.textContent = registo
    ? 'Ficas com as tuas equipas, jogadores e jogos, só teus.'
    : 'Entra para ver os teus jogos e registar o próximo.';
  document.title = `${registo ? 'Criar conta' : 'Entrar'} · Scouting de Andebol`;
  if (comFoco) document.getElementById(registo ? 'registo-nome' : 'entrar-email').focus();
}

abaEntrar.addEventListener('click', () => mostrar('entrar'));
abaRegisto.addEventListener('click', () => mostrar('registo'));

// Mostrar / esconder a palavra-passe
for (const botao of document.querySelectorAll('.ver-senha')) {
  botao.addEventListener('click', () => {
    const campo = document.getElementById(botao.getAttribute('aria-controls'));
    const mostrarTexto = campo.type === 'password';
    campo.type = mostrarTexto ? 'text' : 'password';
    botao.textContent = mostrarTexto ? 'Esconder' : 'Mostrar';
    botao.setAttribute('aria-pressed', String(mostrarTexto));
  });
}

// ---------------------------------------------------------------------
// Confirmar o email
// ---------------------------------------------------------------------
let emailPorConfirmar = '';
let temporizadorReenvio = null;

function dizerEstado(texto, { erro = false } = {}) {
  estadoConfirmar.hidden = !texto;
  estadoConfirmar.textContent = texto ?? '';
  estadoConfirmar.classList.toggle('erro', erro);
}

/** O botão "Reenviar email" fica parado uns segundos, para ninguém carregar dez vezes seguidas. */
function pausarReenvio(segundos = PAUSA_REENVIO) {
  clearInterval(temporizadorReenvio);
  let restam = segundos;
  const atualizar = () => {
    const parado = restam > 0;
    botaoReenviar.disabled = parado;
    botaoReenviar.textContent = parado ? `Reenviar email (${restam} s)` : 'Reenviar email';
    if (!parado) clearInterval(temporizadorReenvio);
    restam -= 1;
  };
  atualizar();
  temporizadorReenvio = setInterval(atualizar, 1000);
}

/** O ecrã "abre o link que te enviámos". `mensagem` diz o que acabou de acontecer (email enviado ou não). */
function mostrarConfirmar(email, { enviado = true, mensagem = null } = {}) {
  emailPorConfirmar = email;
  entrada.hidden = true;
  painelConfirmar.hidden = false;
  titulo.textContent = 'Confirma o teu email';
  subtitulo.textContent = 'Falta só um passo para ativares a conta.';
  document.title = 'Confirma o teu email · Scouting de Andebol';
  textoConfirmar.replaceChildren(
    'Enviámos uma ligação para ', h('b', {}, email),
    '. Abre-a (neste ou noutro dispositivo) e depois volta aqui para entrar. Se não a vires, procura no spam.');
  if (mensagem) dizerEstado(mensagem, { erro: !enviado });
  else dizerEstado(enviado ? null : 'Não conseguimos enviar o email agora. Carrega em «Reenviar email» daqui a pouco.', { erro: !enviado });
  document.getElementById('dica-teste').hidden = !['localhost', '127.0.0.1'].includes(location.hostname);
  pausarReenvio();
  botaoReenviar.focus();
}

async function reenviar(email, onde) {
  try {
    await enviar('POST', '/api/conta/reenviar-confirmacao', { email });
    mostrarConfirmar(email, { mensagem: `Enviámos outro email para ${email}.` });
  } catch (falha) {
    if (onde) { onde.textContent = falha.message; } else { dizerEstado(falha.message, { erro: true }); }
  }
}

botaoReenviar.addEventListener('click', async () => {
  botaoReenviar.disabled = true;
  dizerEstado(null);
  await reenviar(emailPorConfirmar, null);
});
document.getElementById('ja-confirmei').addEventListener('click', () => {
  clearInterval(temporizadorReenvio);
  mostrar('entrar', false);
  document.getElementById('entrar-email').value = emailPorConfirmar;
  document.getElementById('entrar-senha').focus();
});
document.getElementById('outro-email').addEventListener('click', () => { clearInterval(temporizadorReenvio); mostrar('registo'); });

// ---------------------------------------------------------------------
// Esqueci a palavra-passe
// ---------------------------------------------------------------------
const formEsqueci = document.getElementById('form-esqueci');
const erroEsqueci = document.getElementById('erro-esqueci');
const okEsqueci = document.getElementById('ok-esqueci');
const botaoEsqueci = document.getElementById('botao-esqueci');

function mostrarEsqueci(email) {
  entrada.hidden = true;
  painelConfirmar.hidden = true;
  painelEsqueci.hidden = false;
  titulo.textContent = 'Recuperar a palavra-passe';
  subtitulo.textContent = 'Escreve o email da conta e enviamos-te uma ligação para escolheres outra.';
  document.title = 'Recuperar a palavra-passe · Scouting de Andebol';
  erroEsqueci.textContent = '';
  okEsqueci.hidden = true;
  botaoEsqueci.textContent = 'Enviar ligação';
  document.getElementById('esqueci-email').value = email;
  document.getElementById('dica-teste-esqueci').hidden = true;
  document.getElementById('esqueci-email').focus();
}

document.getElementById('esqueci').addEventListener('click', () => mostrarEsqueci(valor('entrar-email').trim()));
document.getElementById('voltar-entrar').addEventListener('click', () => {
  const email = valor('esqueci-email').trim();
  mostrar('entrar', false);
  document.getElementById('entrar-email').value = email;
  document.getElementById(email ? 'entrar-senha' : 'entrar-email').focus();
});

formEsqueci.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const email = valor('esqueci-email').trim();
  erroEsqueci.textContent = '';
  okEsqueci.hidden = true;
  if (!REGEX_EMAIL.test(email)) { erroEsqueci.textContent = 'Escreve um email válido.'; return; }

  botaoEsqueci.disabled = true;
  try {
    await enviar('POST', '/api/conta/esqueci-palavra-passe', { email });
    // A resposta é a mesma exista a conta ou não: não se revela quem tem conta
    okEsqueci.textContent = `Se existir uma conta com ${email}, enviámos-lhe uma ligação para escolher a palavra-passe nova. Vale 1 hora. Se não a vires, procura no spam.`;
    okEsqueci.hidden = false;
    botaoEsqueci.textContent = 'Enviar outra vez';
    document.getElementById('dica-teste-esqueci').hidden = !['localhost', '127.0.0.1'].includes(location.hostname);
  } catch (falha) {
    erroEsqueci.textContent = falha.message;
  } finally {
    botaoEsqueci.disabled = false;
  }
});

// ---------------------------------------------------------------------
// Formulários
// ---------------------------------------------------------------------
/** Envia o formulário para a API; em caso de sucesso segue (`aoSucesso`). Falhas aparecem por baixo dos campos. */
function ligarFormulario(formulario, { erroId, botaoId, reenviarId, emailId, validar, enviarPara, corpo, aoSucesso }) {
  const erro = document.getElementById(erroId);
  const botao = document.getElementById(botaoId);
  const botaoReenvio = document.getElementById(reenviarId);

  botaoReenvio.addEventListener('click', async () => {
    botaoReenvio.disabled = true;
    await reenviar(document.getElementById(emailId).value.trim(), erro);
    botaoReenvio.disabled = false;
  });

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    erro.textContent = '';
    botaoReenvio.hidden = true;
    const problema = validar();
    if (problema) { erro.textContent = problema; return; }

    botao.disabled = true;
    try {
      aoSucesso(await enviar('POST', enviarPara, corpo()));
    } catch (falha) {
      erro.textContent = falha.message;
      botaoReenvio.hidden = falha.codigo !== CODIGO_POR_CONFIRMAR;   // conta criada mas ainda por confirmar: oferece outro email
      botao.disabled = false;
    }
  });
}

const valor = (id) => document.getElementById(id).value;

ligarFormulario(formEntrar, {
  erroId: 'erro-entrar', botaoId: 'botao-entrar', reenviarId: 'reenviar-entrar', emailId: 'entrar-email', enviarPara: '/api/conta/entrar',
  validar: () => (!valor('entrar-email').trim() || !valor('entrar-senha') ? 'Escreve o email e a palavra-passe.' : null),
  corpo: () => ({ email: valor('entrar-email').trim(), palavraPasse: valor('entrar-senha') }),
  aoSucesso: () => location.replace(destino()),
});

ligarFormulario(formRegisto, {
  erroId: 'erro-registo', botaoId: 'botao-registo', reenviarId: 'reenviar-registo', emailId: 'registo-email', enviarPara: '/api/conta/registar',
  validar: () => {
    const nome = valor('registo-nome').trim();
    const equipa = valor('registo-equipa').trim();
    const email = valor('registo-email').trim();
    const senha = valor('registo-senha');
    if (!nome) return 'Escreve o teu nome.';
    if (nome.length > 80) return 'O nome pode ter no máximo 80 caracteres.';
    if (!equipa) return 'Escreve o nome da tua equipa.';
    if (equipa.length > 80) return 'O nome da equipa pode ter no máximo 80 caracteres.';
    if (!REGEX_EMAIL.test(email)) return 'Escreve um email válido.';
    if (senha.length < 8) return 'A palavra-passe tem de ter pelo menos 8 caracteres.';
    if (!senha.trim()) return 'A palavra-passe não pode ter só espaços.';
    if (!/\p{L}/u.test(senha) || !/\p{Nd}/u.test(senha)) return 'A palavra-passe tem de ter pelo menos uma letra e um número.';
    return null;
  },
  corpo: () => ({
    nome: valor('registo-nome').trim(), equipa: valor('registo-equipa').trim(), email: valor('registo-email').trim(), palavraPasse: valor('registo-senha'),
  }),
  aoSucesso: (resposta) => {
    document.getElementById('botao-registo').disabled = false;
    formRegisto.reset();
    mostrarConfirmar(resposta.email, { enviado: resposta.emailEnviado });
  },
});

// Arranque: quem já tem sessão não precisa de entrar outra vez
try {
  if (await obterConta()) location.replace(destino());
} catch { /* sem resposta da API: mostra o formulário na mesma */ }

mostrar(params.get('modo') === 'registo' ? 'registo' : 'entrar', false);
document.getElementById('nota-confirmado').hidden = params.get('confirmado') !== '1';
if (params.get('confirmado') === '1') document.getElementById('entrar-email').focus();
