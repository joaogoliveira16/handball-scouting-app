// Convocatória: escolher, antes do jogo, os jogadores convocados de cada equipa.
import { h, substituir, avisar } from './dom.js';
import { obter, enviar, ROTULO_POSICAO, urlExcel } from './api.js';

const jogoId = Number(new URLSearchParams(location.search).get('jogo'));
if (!jogoId) location.replace('./');

const conteudo = document.getElementById('conteudo');

const estado = {
  jogo: null,
  max: 16,
  selecionados: new Set(),   // ids dos jogadores convocados (o que está no ecrã)
  guardados: new Set(),      // ids guardados no servidor
  semLista: new Set(),       // equipas que ainda não tinham convocatória guardada
  aGuardar: false,
};

const equipas = () => [
  { id: estado.jogo.casaId, nome: estado.jogo.casaNome, lado: 'casa' },
  { id: estado.jogo.foraId, nome: estado.jogo.foraNome, lado: 'fora' },
];
const plantelDe = (equipaId) => estado.jogo.jogadores.filter((j) => j.equipaId === equipaId).sort((a, b) => a.numero - b.numero);
const convocadosDe = (equipaId) => plantelDe(equipaId).filter((j) => estado.selecionados.has(j.id));

function iguais(a, b) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}
const porGuardar = () => !iguais(estado.selecionados, estado.guardados);

/** Estado inicial: o que está guardado; equipas sem lista guardada começam com todos (se couberem). */
function iniciarSelecao() {
  estado.guardados = new Set(estado.jogo.jogadores.filter((j) => j.convocado).map((j) => j.id));
  estado.selecionados = new Set(estado.guardados);
  estado.semLista.clear();
  for (const equipa of equipas()) {
    const plantel = plantelDe(equipa.id);
    if (plantel.some((j) => j.convocado)) continue;
    estado.semLista.add(equipa.id);
    if (plantel.length <= estado.max) plantel.forEach((j) => estado.selecionados.add(j.id));
  }
}

// ---------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------
function alternar(jogador) {
  if (estado.selecionados.has(jogador.id)) {
    estado.selecionados.delete(jogador.id);
  } else if (convocadosDe(jogador.equipaId).length >= estado.max) {
    avisar(`Máximo de ${estado.max} convocados por equipa.`, { erro: true });
    return;
  } else {
    estado.selecionados.add(jogador.id);
  }
  desenhar();
}

function escolherTodos(equipaId) {
  const plantel = plantelDe(equipaId);
  for (const j of plantel) estado.selecionados.delete(j.id);
  for (const j of plantel.slice(0, estado.max)) estado.selecionados.add(j.id);
  if (plantel.length > estado.max) avisar(`Só cabem ${estado.max}: ficaram os primeiros por número.`);
  desenhar();
}

function escolherNenhum(equipaId) {
  for (const j of plantelDe(equipaId)) estado.selecionados.delete(j.id);
  desenhar();
}

async function guardar() {
  if (estado.aGuardar) return;
  estado.aGuardar = true;
  desenhar();
  try {
    await enviar('PUT', `/api/jogos/${jogoId}/convocados`, { jogadorIds: [...estado.selecionados] });
    for (const j of estado.jogo.jogadores) j.convocado = estado.selecionados.has(j.id);
    estado.guardados = new Set(estado.selecionados);
    estado.semLista.clear();
    avisar('Convocatória guardada.');
  } catch (erro) {
    avisar(`Não foi possível guardar: ${erro.message}`, { erro: true });
  } finally {
    estado.aGuardar = false;
    desenhar();
  }
}

// ---------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------
function azulejo(jogador, cheia) {
  const ativo = estado.selecionados.has(jogador.id);
  return h('button', {
    type: 'button', class: 'azulejo', 'aria-pressed': ativo ? 'true' : 'false', 'data-posicao': jogador.posicao,
    disabled: cheia && !ativo, title: ROTULO_POSICAO[jogador.posicao] ?? jogador.posicao,
    onclick: () => alternar(jogador),
  }, h('b', {}, jogador.numero), h('span', { class: 'nome' }, jogador.nome), h('span', { class: 'pos' }, jogador.posicao));
}

function colunaEquipa(equipa) {
  const plantel = plantelDe(equipa.id);
  const escolhidos = convocadosDe(equipa.id);
  const cheia = escolhidos.length >= estado.max;
  const avisos = [];
  if (plantel.length > 0) {
    if (escolhidos.length === 0) {
      avisos.push(h('p', { class: 'aviso-inline' }, plantel.length > estado.max
        ? `O plantel tem mais de ${estado.max} jogadores: escolhe quem joga. Sem escolha, o banco mostra todos.`
        : 'Sem convocados: o banco mostra todos os jogadores desta equipa.'));
    } else if (estado.semLista.has(equipa.id)) {
      avisos.push(h('p', { class: 'aviso-inline' }, 'Sem convocatória guardada: vêm todos selecionados. Retira quem não joga e guarda.'));
    }
  }
  if (escolhidos.length > 0 && !escolhidos.some((j) => j.posicao === 'GR')) {
    avisos.push(h('p', { class: 'aviso-inline' }, 'Atenção: nenhum guarda-redes convocado.'));
  }

  return h('section', { class: 'cartao coluna-equipa', 'data-lado': equipa.lado },
    h('div', { class: 'cabecalho-equipa' },
      h('h3', {}, equipa.nome),
      h('span', { class: `contador${cheia ? ' cheio' : ''}` }, escolhidos.length, h('small', {}, ` / ${estado.max}`)),
      h('div', { class: 'atalhos' },
        h('button', { type: 'button', class: 'botao suave pequeno', onclick: () => escolherTodos(equipa.id) }, 'Todos'),
        h('button', { type: 'button', class: 'botao suave pequeno', onclick: () => escolherNenhum(equipa.id) }, 'Nenhum'))),
    plantel.length
      ? h('div', { class: 'grelha-azulejos' }, plantel.map((j) => azulejo(j, cheia)))
      : h('p', { class: 'vazio' }, 'Esta equipa ainda não tem jogadores.'),
    avisos,
    h('p', { style: 'margin:12px 0 0' },
      h('a', { class: 'botao-link suave pequeno', href: `equipas.html?equipa=${equipa.id}` }, 'Gerir jogadores')));
}

function desenhar() {
  const sujo = porGuardar();
  substituir(conteudo,
    h('div', { class: 'convocatoria' }, equipas().map(colunaEquipa)),
    h('div', { class: 'barra-acoes' },
      h('span', { class: `estado${sujo ? ' sujo' : ''}`, role: 'status' },
        sujo ? 'Alterações por guardar' : 'Convocatória guardada'),
      h('button', { type: 'button', class: 'botao primario', disabled: estado.aGuardar || !sujo, onclick: guardar },
        estado.aGuardar ? 'A guardar…' : 'Guardar convocatória'),
      h('a', { class: 'botao-link pequeno', href: `banco.html?jogo=${jogoId}` }, 'Abrir banco'),
      h('a', { class: 'botao-link suave pequeno', href: `dashboard.html?jogo=${jogoId}` }, 'Dashboard'),
      h('a', { class: 'botao-link suave pequeno', href: urlExcel(jogoId), download: '' }, '⬇ Excel')));
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
try {
  estado.jogo = await obter(`/api/jogos/${jogoId}`);
  estado.max = estado.jogo.maxConvocados ?? 16;
  document.title = `Convocatória · ${estado.jogo.casaNome} vs ${estado.jogo.foraNome}`;
  document.getElementById('titulo').textContent = 'Convocatória';
  document.getElementById('sub').textContent =
    `${estado.jogo.casaNome} vs ${estado.jogo.foraNome} · escolhe os convocados de cada equipa (máximo de ${estado.max}).`;
  iniciarSelecao();
  desenhar();
} catch (erro) {
  substituir(conteudo,
    h('p', { class: 'vazio' }, `Não foi possível carregar o jogo: ${erro.message}`),
    h('a', { href: './' }, '← Voltar à lista de jogos'));
}
