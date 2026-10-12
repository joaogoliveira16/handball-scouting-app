// Área de convidado: abrir o dashboard de um jogo a partir do link de partilha, sem conta.
import { h, substituir } from './dom.js';
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

// Quem já tem conta iniciada vê o seu menu em vez de «Tenho conta»
try {
  const conta = await obterConta();
  if (conta) {
    document.getElementById('link-conta').remove();
    mostrarMenu(conta);
    document.getElementById('conta-menu').prepend(h('a', { class: 'botao-link suave pequeno', href: './' }, 'Os meus jogos'));
  }
} catch { /* sem resposta da API: a área de convidado funciona na mesma */ }
