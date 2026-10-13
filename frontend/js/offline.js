// Sem rede no pavilhão: regista o service worker (que guarda a app no tablet) e lê os jogos que o banco já guardou.
// O service worker só funciona em https ou em localhost; sem ele a fila de eventos funciona na mesma,
// só que a página do banco tem de estar já aberta quando a rede cai.

/** Chave onde o banco guarda o jogo, os tipos de evento e as últimas estatísticas para abrir sem rede. */
export const chaveCacheBanco = (jogoId) => `banco-cache-${jogoId}`;

/** Regista o service worker quando a página acaba de carregar (para não competir com o arranque). Nunca falha. */
export function registarOffline() {
  if (!('serviceWorker' in navigator)) return;
  const registar = () => { navigator.serviceWorker.register('sw.js').catch(() => {}); };
  if (document.readyState === 'complete') registar();
  else window.addEventListener('load', registar, { once: true });
}

/** Os jogos que este tablet já abriu no banco e pode voltar a abrir sem rede: [{ id, casaNome, foraNome }]. */
export function jogosGuardados(armazenamento = globalThis.localStorage) {
  const jogos = [];
  try {
    for (let i = 0; i < armazenamento.length; i += 1) {
      const chave = armazenamento.key(i);
      const id = /^banco-cache-(\d+)$/.exec(chave ?? '')?.[1];
      if (!id) continue;
      const jogo = JSON.parse(armazenamento.getItem(chave))?.jogo;
      if (jogo?.casaNome) jogos.push({ id: Number(id), casaNome: jogo.casaNome, foraNome: jogo.foraNome });
    }
  } catch { /* sem armazenamento: não há jogos para mostrar */ }
  return jogos.sort((a, b) => b.id - a.id);
}
