// A equipa da conta e o seu plantel: adicionar, editar e apagar jogadores. Os adversários não se listam aqui:
// criam-se ao criar o jogo e abrem-se a partir da convocatória (equipas.html?equipa=ID).
import { h, substituir, avisar } from './dom.js';
import { obter, enviar, enviarFicheiro, POSICOES, ROTULO_POSICAO } from './api.js';
import { exigirConta } from './conta.js';
import { escudo, iniciais, prepararEscudo } from './escudo.js';

await exigirConta();

const estado = {
  equipas: [],           // todas as equipas da conta; a da conta tem propria = true
  equipaId: null,
  adversarioId: null,    // adversário aberto a partir da convocatória (só aparece na lista enquanto estiver aberto)
  jogadores: [],
  aEditar: null,   // jogador em edição (null = a adicionar um novo)
};

const listaEquipas = document.getElementById('equipas');
const tituloEquipas = document.getElementById('titulo-equipas');
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

// ---------------------------------------------------------------------
// Escudo da equipa (o seletor de ficheiros é criado uma vez)
// ---------------------------------------------------------------------
const campoEscudo = h('input', {
  type: 'file', id: 'ficheiro-escudo', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', hidden: true,
  onchange: () => escolherEscudo(),
});
const zonaEscudo = h('div', { class: 'escudo-atual', 'aria-hidden': 'true' });
const nomeEscudo = h('strong', {}, 'Escudo');
const botaoEscudo = h('button', { type: 'button', id: 'escolher-escudo', class: 'botao pequeno', onclick: () => campoEscudo.click() }, 'Escolher imagem');
const botaoRemoverEscudo = h('button', { type: 'button', id: 'remover-escudo', class: 'botao perigo pequeno', onclick: () => removerEscudo() }, 'Tirar escudo');
const erroEscudo = h('p', { class: 'erro-formulario', role: 'alert' });
const blocoEscudo = h('div', { class: 'bloco-escudo', id: 'bloco-escudo' },
  zonaEscudo,
  h('div', { class: 'texto' },
    nomeEscudo,
    h('small', {}, 'PNG, JPEG, WebP ou SVG. Aparece no placar e nas listas de jogos; a imagem fica reduzida a 256 px.'),
    h('div', { class: 'acoes-linha' }, botaoEscudo, botaoRemoverEscudo, campoEscudo),
    erroEscudo));

cartaoPlantel.replaceChildren(blocoEscudo, tituloPlantel, zonaTabela, formJogador);

const equipaAtual = () => estado.equipas.find((e) => e.id === estado.equipaId) ?? null;
const equipaDaConta = () => estado.equipas.find((e) => e.propria) ?? null;
/** A lista só mostra a equipa da conta e, se vieste da convocatória, o adversário que abriste. */
const equipasVisiveis = () => estado.equipas.filter((e) => e.propria || e.id === estado.adversarioId);

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
  const visiveis = equipasVisiveis();
  const semEquipa = !equipaDaConta();
  tituloEquipas.textContent = visiveis.length > 1 ? 'Equipas' : 'Equipa';
  formEquipa.hidden = !semEquipa;   // só quem ainda não tem equipa a cria aqui
  substituir(listaEquipas, visiveis.length
    ? visiveis.map((e) => h('li', {}, h('button', {
      type: 'button', class: 'item-equipa', 'aria-current': e.id === estado.equipaId ? 'true' : 'false',
      onclick: () => selecionar(e.id),
    }, h('span', { class: 'nome-equipa' }, escudo(e.id, e.escudo), h('span', {}, e.nome, e.propria ? '' : ' (adversário)')), h('small', {}, `${e.jogadores} jog.`))))
    : h('li', { class: 'vazio' }, 'Ainda não tens equipa. Cria a tua abaixo.'));
}

function desenharEscudo() {
  const equipa = equipaAtual();
  blocoEscudo.hidden = !equipa;
  if (!equipa) return;
  erroEscudo.textContent = '';
  nomeEscudo.textContent = `Escudo · ${equipa.nome}`;
  substituir(zonaEscudo, escudo(equipa.id, equipa.escudo, 'grande') ?? h('span', { class: 'escudo-vazio' }, iniciais(equipa.nome) || '?'));
  botaoEscudo.textContent = equipa.escudo != null ? 'Trocar imagem' : 'Escolher imagem';
  botaoRemoverEscudo.hidden = equipa.escudo == null;
}

async function escolherEscudo() {
  const equipa = equipaAtual();
  const ficheiro = campoEscudo.files?.[0];
  campoEscudo.value = '';   // deixa escolher a mesma imagem outra vez
  if (!equipa || !ficheiro) return;
  erroEscudo.textContent = '';
  botaoEscudo.disabled = true;
  try {
    const imagem = await prepararEscudo(ficheiro);
    await enviarFicheiro('PUT', `/api/equipas/${equipa.id}/escudo`, imagem);
    avisar(`Escudo de ${equipa.nome} guardado.`);
    await carregarEquipas();
    desenharEscudo();
  } catch (erro) {
    erroEscudo.textContent = erro.message;
  } finally {
    botaoEscudo.disabled = false;
  }
}

async function removerEscudo() {
  const equipa = equipaAtual();
  if (!equipa || equipa.escudo == null) return;
  if (!confirm(`Tirar o escudo de ${equipa.nome}?`)) return;
  try {
    await enviar('DELETE', `/api/equipas/${equipa.id}/escudo`);
    avisar('Escudo retirado.');
    await carregarEquipas();
    desenharEscudo();
  } catch (erro) {
    erroEscudo.textContent = erro.message;
  }
}

function desenharPlantel() {
  const equipa = equipaAtual();
  cartaoPlantel.hidden = false;
  desenharEscudo();
  formJogador.hidden = !equipa;
  tituloPlantel.textContent = equipa ? `Plantel · ${equipa.nome}` : 'Plantel';

  if (!equipa) {
    substituir(zonaTabela, h('p', { class: 'vazio' }, 'Cria a tua equipa para começar.'));
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

  substituir(zonaTabela, h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
    h('thead', {}, h('tr', {}, h('th', { class: 'num' }, 'Nº'), h('th', {}, 'Nome'), h('th', {}, 'Posição'), h('th', { class: 'num' }, 'Eventos'), h('th', {}, ''))),
    h('tbody', {}, linhas))));
}

// ---------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------
async function carregarEquipas() {
  estado.equipas = await obter('/api/equipas');
  if (!estado.equipas.some((e) => e.id === estado.adversarioId && !e.propria)) estado.adversarioId = null;
  if (!equipasVisiveis().some((e) => e.id === estado.equipaId)) estado.equipaId = equipaDaConta()?.id ?? null;
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
    avisar(`A tua equipa "${nome}" está criada.`);
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
  estado.adversarioId = pedida || null;   // se for a da conta, carregarEquipas() larga-o
  await carregarEquipas();
  await carregarJogadores();
  iniciarFormulario(null);
} catch (erro) {
  substituir(cartaoPlantel, h('p', { class: 'vazio' }, `Não foi possível carregar as equipas: ${erro.message}`));
}
