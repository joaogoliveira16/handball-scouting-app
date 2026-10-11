// Lista de jogos e criação de um jogo novo.
import { h, substituir } from './dom.js';
import { obter, enviar, urlExcel } from './api.js';

const contentor = document.getElementById('jogos');
const formulario = document.getElementById('form-jogo');
const selectCasa = document.getElementById('casa');
const selectFora = document.getElementById('fora');
const erroJogo = document.getElementById('erro-jogo');
const botaoCriar = document.getElementById('criar-jogo');

function cartaoJogo(jogo) {
  const data = new Date(jogo.dataHora).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' });
  return h('div', { class: 'cartao jogo-cartao' },
    h('div', { class: 'info' },
      h('div', { class: 'equipas' }, `${jogo.casaNome} vs ${jogo.foraNome}`),
      h('div', { class: 'meta' }, [data, jogo.local].filter(Boolean).join(' · '))),
    h('div', { class: 'resultado' }, `${jogo.golosCasa} – ${jogo.golosFora}`),
    h('div', { class: 'acoes-jogo' },
      h('a', { class: 'botao-link primario', href: `banco.html?jogo=${jogo.id}` }, 'Banco'),
      h('a', { class: 'botao-link', href: `dashboard.html?jogo=${jogo.id}` }, 'Dashboard'),
      h('a', { class: 'botao-link suave pequeno', href: `convocatoria.html?jogo=${jogo.id}` }, 'Convocatória'),
      h('a', { class: 'botao-link suave pequeno', href: urlExcel(jogo.id), download: '' }, '⬇ Excel')));
}

async function carregarJogos() {
  try {
    const jogos = await obter('/api/jogos');
    substituir(contentor, jogos.length
      ? jogos.map(cartaoJogo)
      : h('p', { class: 'vazio' }, 'Ainda não há jogos. Cria o primeiro acima.'));
    if (!jogos.length) document.getElementById('novo-jogo').open = true;
  } catch (erro) {
    substituir(contentor, h('p', { class: 'vazio' }, `Não foi possível carregar os jogos: ${erro.message}`));
  }
}

async function prepararFormulario() {
  let equipas = [];
  try {
    equipas = await obter('/api/equipas');
  } catch (erro) {
    erroJogo.textContent = `Não foi possível carregar as equipas: ${erro.message}`;
    botaoCriar.disabled = true;
    return;
  }

  const opcoes = () => equipas.map((e) => h('option', { value: e.id }, e.nome));
  substituir(selectCasa, opcoes());
  substituir(selectFora, opcoes());
  if (equipas.length > 1) selectFora.selectedIndex = 1;

  if (equipas.length < 2) {
    erroJogo.textContent = 'Precisas de pelo menos duas equipas para criar um jogo (ver página Equipas).';
    botaoCriar.disabled = true;
  }
}

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  erroJogo.textContent = '';

  const casaId = Number(selectCasa.value);
  const foraId = Number(selectFora.value);
  if (!casaId || !foraId) { erroJogo.textContent = 'Escolhe as duas equipas.'; return; }
  if (casaId === foraId) { erroJogo.textContent = 'A equipa da casa e a de fora têm de ser diferentes.'; return; }

  let dataHora = null;
  const escolhida = document.getElementById('data-hora').value;
  if (escolhida) {
    const data = new Date(escolhida); // hora local do tablet
    if (Number.isNaN(data.getTime())) { erroJogo.textContent = 'Data e hora inválidas.'; return; }
    dataHora = data.toISOString();
  }

  botaoCriar.disabled = true;
  try {
    const criado = await enviar('POST', '/api/jogos', {
      casaId, foraId, local: document.getElementById('local').value.trim() || null, dataHora,
    });
    location.assign(`convocatoria.html?jogo=${criado.id}`);
  } catch (erro) {
    erroJogo.textContent = erro.message;
    botaoCriar.disabled = false;
  }
});

await Promise.all([carregarJogos(), prepararFormulario()]);
