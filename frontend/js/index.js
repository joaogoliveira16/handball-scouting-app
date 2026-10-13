// Lista de jogos, criação de um jogo novo e link de partilha do dashboard.
import { h, substituir, avisar, copiarTexto } from './dom.js';
import { obter, enviar, urlExcel, urlPartilha } from './api.js';
import { exigirConta } from './conta.js';

await exigirConta();

const contentor = document.getElementById('jogos');
const tituloJogos = document.getElementById('titulo-jogos');
const novoJogo = document.getElementById('novo-jogo');
const formulario = document.getElementById('form-jogo');
const selectCasa = document.getElementById('casa');
const selectFora = document.getElementById('fora');
const erroJogo = document.getElementById('erro-jogo');
const botaoCriar = document.getElementById('criar-jogo');

async function partilhar(jogo) {
  const link = urlPartilha(jogo.id, jogo.codigo);
  if (await copiarTexto(link)) {
    avisar('Link copiado. Quem o abrir vê o jogo em direto, sem conta.');
  } else {
    window.prompt('Copia este link para partilhar o jogo em direto:', link);
  }
}

/** O dono mostra ou esconde o jogo na lista de jogos em direto da área de convidado. */
async function mudarVisibilidade(jogo, caixa) {
  const visivel = caixa.checked;
  caixa.disabled = true;
  try {
    await enviar('PUT', `/api/jogos/${jogo.id}/visibilidade`, { visivel });
    jogo.visivelConvidados = visivel;
    avisar(visivel
      ? 'Este jogo aparece na área de convidado enquanto estiver em direto.'
      : 'Jogo escondido: só quem tem o link o vê.');
  } catch (erro) {
    caixa.checked = !visivel;
    avisar(`Não foi possível mudar: ${erro.message}`, { erro: true });
  } finally {
    caixa.disabled = false;
  }
}

function linhaJogo(jogo) {
  const caixaVisivel = h('input', { type: 'checkbox', checked: jogo.visivelConvidados !== false });
  caixaVisivel.addEventListener('change', () => mudarVisibilidade(jogo, caixaVisivel));
  const data = new Date(jogo.dataHora).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' });
  return h('li', { class: 'jogo-linha' },
    h('div', { class: 'info' },
      h('div', { class: 'equipas' },
        h('span', {}, jogo.casaNome), h('span', { class: 'contra' }, 'vs'), h('span', {}, jogo.foraNome)),
      h('div', { class: 'meta' }, [data, jogo.local].filter(Boolean).join(' · '))),
    h('div', { class: 'resultado', 'aria-label': `Resultado ${jogo.golosCasa} a ${jogo.golosFora}` }, `${jogo.golosCasa} – ${jogo.golosFora}`),
    h('div', { class: 'acoes-jogo' },
      h('a', { class: 'botao-link primario pequeno', href: `banco.html?jogo=${jogo.id}` }, 'Banco'),
      h('a', { class: 'botao-link pequeno', href: `dashboard.html?jogo=${jogo.id}&c=${encodeURIComponent(jogo.codigo)}` }, 'Dashboard'),
      h('button', {
        type: 'button', class: 'botao pequeno', title: 'Copiar o link do dashboard em direto, para quem não tem conta',
        onclick: () => partilhar(jogo),
      }, 'Copiar link'),
      h('a', { class: 'botao-link suave pequeno', href: `convocatoria.html?jogo=${jogo.id}` }, 'Convocatória'),
      h('a', { class: 'botao-link suave pequeno', href: urlExcel(jogo.id), download: '' }, '⬇ Excel')),
    h('label', {
      class: 'opcao-jogo',
      title: 'Quem não tem conta vê este jogo na área de convidado enquanto estiver a ser registado, sem precisar do link',
    }, caixaVisivel, 'Mostrar na área de convidado'));
}

/** Conta ainda sem jogos: mostra os três passos, a começar pelo que falta. */
function estadoVazio(equipas) {
  const temEquipas = equipas.length >= 2;
  return h('section', { class: 'estado-vazio' },
    h('h2', {}, 'Ainda não tens jogos'),
    h('p', {}, 'Em três passos tens o primeiro jogo a ser registado.'),
    h('ol', { class: 'passos' },
      h('li', {}, h('div', {}, h('strong', {}, 'Cria as equipas e os jogadores'), h('span', {}, 'Precisas de duas equipas, a tua e a adversária.'))),
      h('li', {}, h('div', {}, h('strong', {}, 'Cria o jogo e escolhe os convocados'), h('span', {}, 'Até 16 jogadores por equipa.'))),
      h('li', {}, h('div', {}, h('strong', {}, 'Regista no Banco'), h('span', {}, 'Copia o link do dashboard e envia ao treinador: vê tudo em direto, sem conta.')))),
    temEquipas
      ? h('button', { type: 'button', class: 'botao primario', onclick: () => { novoJogo.open = true; selectCasa.focus(); } }, 'Criar o primeiro jogo')
      : h('a', { class: 'botao-link primario', href: 'equipas.html' }, 'Criar equipas e jogadores'));
}

async function carregarJogos(equipas) {
  try {
    const jogos = await obter('/api/jogos');
    tituloJogos.hidden = jogos.length === 0;
    substituir(contentor, jogos.length
      ? h('ul', { class: 'lista-jogos' }, jogos.map(linhaJogo))
      : estadoVazio(equipas));
  } catch (erro) {
    substituir(contentor, h('p', { class: 'vazio' }, `Não foi possível carregar os jogos: ${erro.message}`));
  }
}

async function carregarEquipas() {
  try {
    return await obter('/api/equipas');
  } catch (erro) {
    erroJogo.textContent = `Não foi possível carregar as equipas: ${erro.message}`;
    novoJogo.hidden = false;
    botaoCriar.disabled = true;
    return [];
  }
}

function prepararFormulario(equipas) {
  // Com menos de duas equipas ainda não dá para criar um jogo: o estado vazio leva à página das equipas
  novoJogo.hidden = equipas.length < 2 && !erroJogo.textContent;
  if (equipas.length < 2) return;

  const opcoes = () => equipas.map((e) => h('option', { value: e.id }, e.nome));
  substituir(selectCasa, opcoes());
  substituir(selectFora, opcoes());
  selectFora.selectedIndex = 1;
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

const equipas = await carregarEquipas();
prepararFormulario(equipas);
await carregarJogos(equipas);
