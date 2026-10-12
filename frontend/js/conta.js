// Conta do utilizador: quem está com sessão iniciada, menu da conta e saída.
import { h } from './dom.js';

/** A conta da sessão atual, ou null se não houver sessão. Falha só se a API não responder. */
export async function obterConta() {
  const resposta = await fetch('/api/conta', { cache: 'no-store' });
  if (resposta.status === 401) return null;
  if (!resposta.ok) throw new Error(`Erro ${resposta.status}`);
  return resposta.json();
}

/** Página atual (ficheiro + query), para voltar a ela depois de entrar. */
function paginaAtual() {
  const ficheiro = location.pathname.split('/').pop() || './';
  return ficheiro === './' ? './' : `${ficheiro}${location.search}`;
}

/** Leva para a página de entrada. A promise devolvida nunca termina (a página vai ser substituída). */
export function irParaEntrar() {
  const voltar = paginaAtual();
  location.assign(voltar === './' ? 'entrar.html' : `entrar.html?voltar=${encodeURIComponent(voltar)}`);
  return new Promise(() => {});
}

/** Menu da conta no cabeçalho: inicial, nome e botão Sair. */
export function mostrarMenu(conta) {
  const sitio = document.getElementById('conta-menu');
  if (!sitio || !conta) return;
  sitio.replaceChildren(
    h('span', { class: 'quem', title: conta.email },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, (conta.nome || conta.email || '?').trim().charAt(0).toUpperCase()),
      h('span', {}, conta.nome)),
    h('button', { type: 'button', class: 'botao suave pequeno', onclick: sair }, 'Sair'));
}

async function sair(evento) {
  evento.currentTarget.disabled = true;
  try {
    await fetch('/api/conta/sair', { method: 'POST' });
  } catch { /* sem rede: o cookie fica, mas a página de entrada trata disso */ }
  location.assign('entrar.html');
}

/**
 * Para as páginas que só funcionam com conta: sem sessão, vai para a entrada.
 * Se a API não responder, deixa a página seguir (os pedidos seguintes mostram o erro).
 */
export async function exigirConta() {
  let conta = null;
  try {
    conta = await obterConta();
  } catch {
    return null;
  }
  if (!conta) return irParaEntrar();
  mostrarMenu(conta);
  return conta;
}
