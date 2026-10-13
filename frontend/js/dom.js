// Criação de elementos DOM sem innerHTML (os nomes vêm da base de dados, por isso nada de HTML em texto).
export function h(tag, atributos, ...filhos) {
  const el = document.createElement(tag);
  for (const [chave, valor] of Object.entries(atributos ?? {})) {
    if (valor == null || valor === false) continue;
    if (chave === 'class') el.className = valor;
    else if (chave.startsWith('on') && typeof valor === 'function') el.addEventListener(chave.slice(2), valor);
    else el.setAttribute(chave, valor === true ? '' : valor);
  }
  for (const filho of filhos.flat(Infinity)) {
    if (filho == null || filho === false) continue;
    el.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
  return el;
}

export function substituir(pai, ...filhos) {
  pai.replaceChildren(...filhos.flat(Infinity).filter((f) => f != null && f !== false));
  return pai;
}

let temporizadorAviso = null;
export function avisar(texto, { erro = false, duracao = null } = {}) {
  const el = document.getElementById('aviso');
  if (!el) return;
  el.textContent = texto;
  el.classList.toggle('erro', erro);
  el.classList.add('visivel');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => el.classList.remove('visivel'), duracao ?? (erro ? 4500 : 2200));
}

/** Copia texto para a área de transferência. Devolve false se o browser não deixar (ex.: página sem HTTPS). */
export async function copiarTexto(texto) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch { /* cai para o método antigo */ }
  const campo = h('textarea', { readonly: true, 'aria-hidden': 'true', style: 'position:fixed;top:-100px;opacity:0' }, texto);
  document.body.append(campo);
  campo.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  campo.remove();
  return ok;
}
