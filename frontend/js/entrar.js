// Entrar e criar conta.
import { enviar } from './api.js';
import { obterConta } from './conta.js';

const formEntrar = document.getElementById('form-entrar');
const formRegisto = document.getElementById('form-registo');
const abaEntrar = document.getElementById('aba-entrar');
const abaRegisto = document.getElementById('aba-registo');
const titulo = document.getElementById('titulo-caixa');
const subtitulo = document.getElementById('sub-caixa');

const REGEX_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Para onde ir depois de entrar: a página de onde veio (só ficheiros .html deste site) ou a lista de jogos. */
function destino() {
  const voltar = new URLSearchParams(location.search).get('voltar');
  const valido = voltar && /^[a-z]+\.html(\?[\w=&%.\-]*)?$/.test(voltar) && !voltar.startsWith('entrar.html');
  return valido ? voltar : './';
}

function mostrar(modo, comFoco = true) {
  const registo = modo === 'registo';
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

/** Envia o formulário para a API; em caso de sucesso segue para a página de destino. */
function ligarFormulario(formulario, { erroId, botaoId, validar, enviarPara, corpo }) {
  const erro = document.getElementById(erroId);
  const botao = document.getElementById(botaoId);
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    erro.textContent = '';
    const problema = validar();
    if (problema) { erro.textContent = problema; return; }

    botao.disabled = true;
    try {
      await enviar('POST', enviarPara, corpo());
      location.replace(destino());
    } catch (falha) {
      erro.textContent = falha.message;
      botao.disabled = false;
    }
  });
}

const valor = (id) => document.getElementById(id).value;

ligarFormulario(formEntrar, {
  erroId: 'erro-entrar', botaoId: 'botao-entrar', enviarPara: '/api/conta/entrar',
  validar: () => (!valor('entrar-email').trim() || !valor('entrar-senha') ? 'Escreve o email e a palavra-passe.' : null),
  corpo: () => ({ email: valor('entrar-email').trim(), palavraPasse: valor('entrar-senha') }),
});

ligarFormulario(formRegisto, {
  erroId: 'erro-registo', botaoId: 'botao-registo', enviarPara: '/api/conta/registar',
  validar: () => {
    const nome = valor('registo-nome').trim();
    const email = valor('registo-email').trim();
    const senha = valor('registo-senha');
    if (!nome) return 'Escreve o teu nome.';
    if (nome.length > 80) return 'O nome pode ter no máximo 80 caracteres.';
    if (!REGEX_EMAIL.test(email)) return 'Escreve um email válido.';
    if (senha.length < 8) return 'A palavra-passe tem de ter pelo menos 8 caracteres.';
    if (!senha.trim()) return 'A palavra-passe não pode ter só espaços.';
    return null;
  },
  corpo: () => ({ nome: valor('registo-nome').trim(), email: valor('registo-email').trim(), palavraPasse: valor('registo-senha') }),
});

// Arranque: quem já tem sessão não precisa de entrar outra vez
try {
  if (await obterConta()) location.replace(destino());
} catch { /* sem resposta da API: mostra o formulário na mesma */ }

mostrar(new URLSearchParams(location.search).get('modo') === 'registo' ? 'registo' : 'entrar', false);
