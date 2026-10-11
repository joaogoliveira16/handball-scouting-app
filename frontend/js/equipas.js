// Equipas e jogadores: criar equipas, adicionar, editar e apagar jogadores.
import { h, substituir, avisar } from './dom.js';
import { obter, enviar, POSICOES, ROTULO_POSICAO } from './api.js';

const estado = {
  equipas: [],
  equipaId: null,
  jogadores: [],
  aEditar: null,   // jogador em edição (null = a adicionar um novo)
};

const listaEquipas = document.getElementById('equipas');
const cartaoPlantel = document.getElementById('plantel');
const formEquipa = document.getElementById('form-equipa');
const nomeEquipa = document.getElementById('nome-equipa');
const erroEquipa = document.getElementById('erro-equipa');

// ---------------------------------------------------------------------
// Formulário de jogador (criado uma vez, para não perder o que se está a escrever)
// ---------------------------------------------------------------------
const campoNumero = h('input', { id: 'numero', type: 'number', min: 1, max: 99, inputmode: 'numeric', required: true });
const campoNome = h('input', { id: 'nome', maxlength: 80, placeholder: 'Nome do jogador', autocomplete: 'off', required: true });
const campoPosicao = h('select', { id: 'posicao', required: true },
  POSICOES.map((p) => h('option', { value: p.codigo }, `${p.codigo} · ${p.rotulo}`)));
const erroJogador = h('p', { class: 'erro-formulario largo', role: 'alert' });
const botaoGuardar = h('button', { class: 'botao primario', type: 'submit' }, '＋ Adicionar jogador');
const botaoCancelar = h('button', { class: 'botao suave', type: 'button', hidden: true, onclick: () => iniciarFormulario(null) }, 'Cancelar');
const tituloFormulario = h('h2', {}, 'Novo jogador');

const formJogador = h('form', { class: 'formulario formulario-jogador', novalidate: true, onsubmit: guardarJogador },
  h('div', { class: 'largo' }, tituloFormulario),
  h('label', {}, 'Número', campoNumero),
  h('label', {}, 'Nome', campoNome),
  h('label', {}, 'Posição', campoPosicao),
  erroJogador,
  h('div', { class: 'largo acoes-formulario' }, botaoGuardar, botaoCancelar));

const tituloPlantel = h('h2', {}, 'Plantel');
const zonaTabela = h('div', {});
cartaoPlantel.replaceChildren(tituloPlantel, zonaTabela, formJogador);

const equipaAtual = () => estado.equipas.find((e) => e.id === estado.equipaId) ?? null;

function proximoNumeroLivre() {
  const usados = new Set(estado.jogadores.map((j) => j.numero));
  for (let n = 1; n <= 99; n++) if (!usados.has(n)) return n;
  return '';
}

/** Põe o formulário em modo "novo" (jogador = null) ou "editar". */
function iniciarFormulario(jogador) {
  estado.aEditar = jogador;
  erroJogador.textContent = '';
  campoNumero.value = jogador ? jogador.numero : proximoNumeroLivre();
  campoNome.value = jogador ? jogador.nome : '';
  campoPosicao.value = jogador ? jogador.posicao : 'LE';
  tituloFormulario.textContent = jogador ? `Editar #${jogador.numero} ${jogador.nome}` : 'Novo jogador';
  botaoGuardar.textContent = jogador ? 'Guardar alterações' : '＋ Adicionar jogador';
  botaoCancelar.hidden = !jogador;
  if (jogador) campoNome.focus();
}

// ---------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------
function desenharEquipas() {
  substituir(listaEquipas, estado.equipas.length
    ? estado.equipas.map((e) => h('li', {}, h('button', {
      type: 'button', class: 'item-equipa', 'aria-current': e.id === estado.equipaId ? 'true' : 'false',
      onclick: () => selecionar(e.id),
    }, h('span', {}, e.nome), h('small', {}, `${e.jogadores} jog.`))))
    : h('li', { class: 'vazio' }, 'Ainda não há equipas.'));
}

function desenharPlantel() {
  const equipa = equipaAtual();
  cartaoPlantel.hidden = false;
  formJogador.hidden = !equipa;
  tituloPlantel.textContent = equipa ? `Plantel · ${equipa.nome}` : 'Plantel';

  if (!equipa) {
    substituir(zonaTabela, h('p', { class: 'vazio' }, 'Cria uma equipa para começar.'));
    return;
  }
  if (!estado.jogadores.length) {
    substituir(zonaTabela, h('p', { class: 'vazio' }, 'Esta equipa ainda não tem jogadores. Adiciona o primeiro abaixo.'));
    return;
  }

  const linhas = [...estado.jogadores].sort((a, b) => a.numero - b.numero).map((j) => h('tr', {},
    h('td', { class: 'num' }, j.numero),
    h('td', {}, j.nome),
    h('td', {}, ROTULO_POSICAO[j.posicao] ?? j.posicao),
    h('td', { class: 'num suave' }, j.eventos > 0 ? `${j.eventos} ev.` : '–'),
    h('td', {}, h('div', { class: 'acoes-linha' },
      h('button', { type: 'button', class: 'botao suave pequeno', title: 'Editar jogador', onclick: () => iniciarFormulario(j) }, '✎ Editar'),
      h('button', {
        type: 'button', class: 'botao perigo pequeno', disabled: j.eventos > 0,
        title: j.eventos > 0 ? 'Tem eventos registados em jogos: não pode ser apagado.' : 'Apagar jogador',
        onclick: () => apagarJogador(j),
      }, '✕')))));

  substituir(zonaTabela, h('table', { class: 'tabela' },
    h('thead', {}, h('tr', {}, h('th', { class: 'num' }, 'Nº'), h('th', {}, 'Nome'), h('th', {}, 'Posição'), h('th', { class: 'num' }, 'Eventos'), h('th', {}, ''))),
    h('tbody', {}, linhas)));
}

// ---------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------
async function carregarEquipas() {
  estado.equipas = await obter('/api/equipas');
  if (!estado.equipas.some((e) => e.id === estado.equipaId)) estado.equipaId = estado.equipas[0]?.id ?? null;
  desenharEquipas();
}

async function carregarJogadores() {
  estado.jogadores = estado.equipaId == null ? [] : await obter(`/api/equipas/${estado.equipaId}/jogadores`);
  desenharPlantel();
}

async function selecionar(equipaId) {
  estado.equipaId = equipaId;
  try {
    history.replaceState(null, '', `?equipa=${equipaId}`);
  } catch { /* sem history */ }
  desenharEquipas();
  try {
    await carregarJogadores();
  } catch (erro) {
    avisar(`Não foi possível carregar o plantel: ${erro.message}`, { erro: true });
  }
  iniciarFormulario(null);
}

async function guardarJogador(evento) {
  evento.preventDefault();
  erroJogador.textContent = '';

  const corpo = { numero: Number(campoNumero.value), nome: campoNome.value.trim(), posicao: campoPosicao.value };
  if (!Number.isInteger(corpo.numero) || corpo.numero < 1 || corpo.numero > 99) { erroJogador.textContent = 'O número tem de estar entre 1 e 99.'; return; }
  if (!corpo.nome) { erroJogador.textContent = 'Escreve o nome do jogador.'; return; }

  const editava = estado.aEditar !== null;
  botaoGuardar.disabled = true;
  try {
    if (editava) await enviar('PUT', `/api/jogadores/${estado.aEditar.id}`, corpo);
    else await enviar('POST', `/api/equipas/${estado.equipaId}/jogadores`, corpo);
    avisar(editava ? 'Jogador atualizado.' : `#${corpo.numero} ${corpo.nome} adicionado.`);
    await Promise.all([carregarJogadores(), carregarEquipas()]);
    iniciarFormulario(null);
    if (!editava) campoNome.focus(); // para adicionar vários jogadores seguidos
  } catch (erro) {
    erroJogador.textContent = erro.message;
  } finally {
    botaoGuardar.disabled = false;
  }
}

async function apagarJogador(jogador) {
  if (!confirm(`Apagar #${jogador.numero} ${jogador.nome}?`)) return;
  try {
    await enviar('DELETE', `/api/jogadores/${jogador.id}`);
    avisar('Jogador apagado.');
    await Promise.all([carregarJogadores(), carregarEquipas()]);
    if (estado.aEditar?.id === jogador.id) iniciarFormulario(null);
  } catch (erro) {
    avisar(erro.message, { erro: true });
  }
}

formEquipa.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  erroEquipa.textContent = '';
  const nome = nomeEquipa.value.trim();
  if (!nome) { erroEquipa.textContent = 'Escreve o nome da equipa.'; return; }
  try {
    const criada = await enviar('POST', '/api/equipas', { nome });
    nomeEquipa.value = '';
    avisar(`Equipa "${nome}" criada.`);
    await carregarEquipas();
    await selecionar(criada.id);
  } catch (erro) {
    erroEquipa.textContent = erro.message;
  }
});

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
try {
  const pedida = Number(new URLSearchParams(location.search).get('equipa'));
  estado.equipaId = pedida || null;
  await carregarEquipas();
  await carregarJogadores();
  iniciarFormulario(null);
} catch (erro) {
  substituir(cartaoPlantel, h('p', { class: 'vazio' }, `Não foi possível carregar as equipas: ${erro.message}`));
}
