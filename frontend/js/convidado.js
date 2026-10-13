// Área de convidado: abrir o dashboard de um jogo a partir do link de partilha, sem conta.
import { h, substituir } from './dom.js';
import { obter } from './api.js';
import { escudo } from './escudo.js';
import { obterConta, mostrarMenu } from './conta.js';
import { lerLinkDoJogo, enderecoDoJogo, jogosLembrados, esquecerJogo, esquecerTodos } from './vistos.js';

const formulario = document.getElementById('form-link');
const campo = document.getElementById('link-jogo');
const erro = document.getElementById('erro-link');
const seccaoVistos = document.getElementById('vistos');
const lista = document.getElementById('lista-vistos');

const DIA_SEMANA_HORA = new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

formulario.addEventListener('submit', (evento) => {
  evento.preventDefault();
  erro.textContent = '';
  const texto = campo.value.trim();
  if (!texto) { erro.textContent = 'Cola o link do jogo.'; return; }
  const jogo = lerLinkDoJogo(texto);
  if (!jogo) {
    erro.textContent = 'Isto não parece o link de um jogo. Pede ao treinador para o copiar outra vez em «Copiar link».';
    return;
  }
  location.assign(enderecoDoJogo(jogo));
});

function linhaDe(jogo) {
  const resultado = jogo.golosCasa != null && jogo.golosFora != null ? `${jogo.golosCasa}–${jogo.golosFora}` : null;
  let quando = '';
  try { quando = DIA_SEMANA_HORA.format(new Date(jogo.visto)); } catch { /* data inválida: sem hora */ }
  return h('li', { class: 'visto' },
    h('a', { class: 'visto-ligacao', href: enderecoDoJogo(jogo) },
      h('span', { class: 'visto-equipas' }, jogo.casa && jogo.fora ? `${jogo.casa} vs ${jogo.fora}` : `Jogo ${jogo.jogo}`),
      h('small', {}, resultado ? `Último resultado visto: ${resultado}${quando ? ` · ${quando}` : ''}` : quando)),
    h('button', {
      type: 'button', class: 'botao suave pequeno', 'aria-label': `Tirar da lista: ${jogo.casa ?? 'jogo'} vs ${jogo.fora ?? jogo.jogo}`,
      onclick: () => { esquecerJogo(jogo.jogo); desenharLista(); },
    }, 'Tirar'));
}

function desenharLista() {
  const jogos = jogosLembrados();
  seccaoVistos.hidden = jogos.length === 0;
  substituir(lista, jogos.map(linhaDe));
}

document.getElementById('limpar-vistos').addEventListener('click', () => { esquecerTodos(); desenharLista(); });
desenharLista();

// ---------------------------------------------------------------------
// Jogos das últimas 24 horas que o dono não escondeu. Abrem-se sem link.
// ---------------------------------------------------------------------
const listaDireto = document.getElementById('lista-direto');
const estadoDireto = document.getElementById('estado-direto');
const ATUALIZAR_MS = 15000;

/** "agora mesmo", "há 1 minuto", "há 12 minutos", "há 3 horas" */
function haQuanto(iso) {
  const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(minutos) || minutos < 1) return 'agora mesmo';
  if (minutos < 60) return `há ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`;
  const horas = Math.floor(minutos / 60);
  return `há ${horas} ${horas === 1 ? 'hora' : 'horas'}`;
}

/** O que dizer do jogo: o último evento, ou (sem eventos) quando começa / começou. */
function estadoDoJogo(jogo) {
  if (jogo.ultimoEvento) return `último evento ${haQuanto(jogo.ultimoEvento)}`;
  const hora = new Date(jogo.dataHora);
  if (hora.getTime() > Date.now()) {
    return `começa às ${hora.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return 'ainda sem eventos';
}

/** Com um evento nos últimos 30 minutos o jogo está mesmo a decorrer: leva o ponto verde. */
const aDecorrer = (jogo) => !!jogo.ultimoEvento && Date.now() - new Date(jogo.ultimoEvento).getTime() < 30 * 60000;

function linhaDireto(jogo) {
  return h('li', { class: aDecorrer(jogo) ? 'jogo-direto ao-vivo' : 'jogo-direto' },
    h('a', { class: 'jogo-direto-ligacao', href: `dashboard.html?jogo=${jogo.id}` },
      h('span', { class: 'jogo-direto-equipas' },
        escudo(jogo.casaId, jogo.casaEscudo), jogo.casaNome,
        h('span', { class: 'contra' }, ' vs '),
        escudo(jogo.foraId, jogo.foraEscudo), jogo.foraNome),
      h('small', {}, [jogo.local, estadoDoJogo(jogo)].filter(Boolean).join(' · '))),
    h('span', { class: 'jogo-direto-resultado', 'aria-label': `Resultado ${jogo.golosCasa} a ${jogo.golosFora}` }, `${jogo.golosCasa}–${jogo.golosFora}`));
}

let aCarregar = false;
async function carregarDireto() {
  if (aCarregar) return;
  aCarregar = true;
  try {
    const jogos = await obter('/api/convidado/jogos-em-direto');
    estadoDireto.hidden = jogos.length > 0;
    estadoDireto.className = 'suave';
    estadoDireto.textContent = 'Não há jogos nas últimas 24 horas. A lista atualiza sozinha.';
    substituir(listaDireto, jogos.map(linhaDireto));
  } catch {
    estadoDireto.hidden = false;
    estadoDireto.className = 'suave erro-suave';
    estadoDireto.textContent = 'Não foi possível ver os jogos agora. Vamos tentar outra vez.';
  } finally {
    aCarregar = false;
  }
}

await carregarDireto();
setInterval(() => { if (!document.hidden) carregarDireto(); }, ATUALIZAR_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) carregarDireto(); });

// Quem já tem conta iniciada vê o seu menu em vez de «Tenho conta»
try {
  const conta = await obterConta();
  if (conta) {
    document.getElementById('link-conta').remove();
    mostrarMenu(conta);
    document.getElementById('conta-menu').prepend(h('a', { class: 'botao-link suave pequeno', href: './' }, 'Os meus jogos'));
  }
} catch { /* sem resposta da API: a área de convidado funciona na mesma */ }
