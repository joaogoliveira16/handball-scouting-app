import { h, substituir } from './dom.js';
import { obter } from './api.js';

const contentor = document.getElementById('jogos');

function cartaoJogo(jogo) {
  const data = new Date(jogo.dataHora).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' });
  return h('div', { class: 'cartao jogo-cartao' },
    h('div', { class: 'info' },
      h('div', { class: 'equipas' }, `${jogo.casaNome} vs ${jogo.foraNome}`),
      h('div', { class: 'meta' }, [data, jogo.local].filter(Boolean).join(' · '))),
    h('div', { class: 'resultado' }, `${jogo.golosCasa} – ${jogo.golosFora}`),
    h('a', { class: 'botao-link', href: `banco.html?jogo=${jogo.id}` }, 'Banco'),
    h('a', { class: 'botao-link claro', href: `dashboard.html?jogo=${jogo.id}` }, 'Dashboard'));
}

try {
  const jogos = await obter('/api/jogos');
  substituir(contentor, jogos.length
    ? jogos.map(cartaoJogo)
    : h('p', { class: 'vazio' }, 'Ainda não há jogos. Cria um na base de dados (ver README).'));
} catch (erro) {
  substituir(contentor, h('p', { class: 'vazio' }, `Não foi possível carregar os jogos: ${erro.message}`));
}
