// Lista de jogos, criação de um jogo novo e link de partilha do dashboard.
import { h, substituir, avisar, copiarTexto } from './dom.js';
import { obter, enviar, urlExcel, urlPartilha } from './api.js';
import { exigirConta } from './conta.js';

await exigirConta();

const contentor = document.getElementById('jogos');
const tituloJogos = document.getElementById('titulo-jogos');
const novoJogo = document.getElementById('novo-jogo');
const formulario = document.getElementById('form-jogo');
const ladoJogo = document.getElementById('lado');
const campoAdversario = document.getElementById('adversario');
const listaAdversarios = document.getElementById('adversarios');
const textoEquipa = document.getElementById('equipa-jogo');
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

/** O dono mostra ou esconde o jogo na lista de jogos da área de convidado. */
async function mudarVisibilidade(jogo, caixa) {
  const visivel = caixa.checked;
  caixa.disabled = true;
  try {
    await enviar('PUT', `/api/jogos/${jogo.id}/visibilidade`, { visivel });
    jogo.visivelConvidados = visivel;
    avisar(visivel
      ? 'Este jogo aparece na área de convidado durante 24 horas.'
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
      title: 'Quem não tem conta vê este jogo na área de convidado durante 24 horas, sem precisar do link',
    }, caixaVisivel, 'Mostrar na área de convidado'));
}

/** Conta ainda sem jogos: mostra os três passos, a começar pelo que falta. */
function estadoVazio(equipas) {
  const temEquipa = equipas.some((e) => e.propria);
  return h('section', { class: 'estado-vazio' },
    h('h2', {}, 'Ainda não tens jogos'),
    h('p', {}, 'Em três passos tens o primeiro jogo a ser registado.'),
    h('ol', { class: 'passos' },
      h('li', {}, h('div', {}, h('strong', {}, temEquipa ? 'Junta os jogadores da tua equipa' : 'Cria a tua equipa'), h('span', {}, 'O plantel fica guardado para todos os jogos.'))),
      h('li', {}, h('div', {}, h('strong', {}, 'Cria o jogo e escolhe os convocados'), h('span', {}, 'Escreve o nome do adversário. Até 16 jogadores por equipa.'))),
      h('li', {}, h('div', {}, h('strong', {}, 'Regista no Banco'), h('span', {}, 'Copia o link do dashboard e envia ao treinador: vê tudo em direto, sem conta.')))),
    temEquipa
      ? h('button', { type: 'button', class: 'botao primario', onclick: () => { novoJogo.open = true; campoAdversario.focus(); } }, 'Criar o primeiro jogo')
      : h('a', { class: 'botao-link primario', href: 'equipas.html' }, 'Criar a minha equipa'));
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
  // O jogo é sempre da equipa da conta contra um adversário: sem equipa da conta não há jogo para criar
  const minha = equipas.find((e) => e.propria);
  novoJogo.hidden = !minha && !erroJogo.textContent;
  if (!minha) return;

  textoEquipa.replaceChildren('A tua equipa: ', h('strong', {}, minha.nome));
  // os adversários que já usaste aparecem como sugestão (assim o plantel deles é reaproveitado)
  substituir(listaAdversarios, equipas.filter((e) => !e.propria).map((e) => h('option', { value: e.nome })));
}

const mesmoNome = (a, b) => a.trim().toLocaleLowerCase('pt-PT') === b.trim().toLocaleLowerCase('pt-PT');

/** O adversário é uma equipa da conta: reaproveita a que já existe com esse nome ou cria-a agora. */
async function equipaAdversaria(nome, equipas) {
  const existente = equipas.find((e) => !e.propria && mesmoNome(e.nome, nome));
  if (existente) return existente.id;
  try {
    return (await enviar('POST', '/api/equipas', { nome })).id;
  } catch (erro) {
    // pode já existir com outras maiúsculas ou ter sido criada noutro separador: volta a procurar
    const atuais = await obter('/api/equipas');
    const igual = atuais.find((e) => !e.propria && mesmoNome(e.nome, nome));
    if (igual) return igual.id;
    throw erro;
  }
}

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  erroJogo.textContent = '';

  const minha = equipasDaConta.find((e) => e.propria);
  const adversario = campoAdversario.value.trim();
  if (!minha) { erroJogo.textContent = 'Cria primeiro a tua equipa.'; return; }
  if (!adversario) { erroJogo.textContent = 'Escreve o nome do adversário.'; return; }
  if (adversario.length > 80) { erroJogo.textContent = 'O nome do adversário pode ter no máximo 80 caracteres.'; return; }
  if (mesmoNome(adversario, minha.nome)) { erroJogo.textContent = 'O adversário tem de ser outra equipa.'; return; }

  let dataHora = null;
  const escolhida = document.getElementById('data-hora').value;
  if (escolhida) {
    const data = new Date(escolhida); // hora local do tablet
    if (Number.isNaN(data.getTime())) { erroJogo.textContent = 'Data e hora inválidas.'; return; }
    dataHora = data.toISOString();
  }

  botaoCriar.disabled = true;
  try {
    const adversarioId = await equipaAdversaria(adversario, equipasDaConta);
    const emCasa = ladoJogo.value === 'casa';
    const criado = await enviar('POST', '/api/jogos', {
      casaId: emCasa ? minha.id : adversarioId, foraId: emCasa ? adversarioId : minha.id,
      local: document.getElementById('local').value.trim() || null, dataHora,
    });
    location.assign(`convocatoria.html?jogo=${criado.id}`);
  } catch (erro) {
    erroJogo.textContent = erro.message;
    botaoCriar.disabled = false;
  }
});

const equipasDaConta = await carregarEquipas();
prepararFormulario(equipasDaConta);
await carregarJogos(equipasDaConta);
