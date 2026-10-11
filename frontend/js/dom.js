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
export function avisar(texto, { erro = false } = {}) {
  const el = document.getElementById('aviso');
  if (!el) return;
  el.textContent = texto;
  el.classList.toggle('erro', erro);
  el.classList.add('visivel');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => el.classList.remove('visivel'), erro ? 4500 : 2200);
}
