// Área de convidado: ler o link de um jogo e lembrar, neste dispositivo, os jogos que a pessoa já abriu.
// A lista fica só no browser de quem vê (localStorage): a API não sabe quem são os convidados.

const CHAVE = 'scouting.convidado.jogos';
const MAXIMO = 20;
const CODIGO = /^[0-9a-f]{20}$/;

/**
 * Tira o número do jogo e o código de um link de partilha. Aceita o link inteiro, só a parte depois do "?"
 * ou uma mensagem que traga o link no meio. Devolve null se não parecer um link de jogo.
 */
export function lerLinkDoJogo(entrada) {
  const pedaco = String(entrada ?? '').split(/\s+/).find((parte) => parte.includes('jogo='));
  if (!pedaco) return null;
  const query = pedaco.split('#')[0].replace(/^[^?]*\?/, '');
  const parametros = new URLSearchParams(query);
  const jogo = Number(parametros.get('jogo'));
  const codigo = (parametros.get('c') ?? '').toLowerCase();
  if (!Number.isInteger(jogo) || jogo <= 0 || !CODIGO.test(codigo)) return null;
  return { jogo, codigo };
}

/** O endereço do dashboard desse jogo, relativo a este site. */
export function enderecoDoJogo({ jogo, codigo }) {
  return `dashboard.html?jogo=${jogo}&c=${codigo}`;
}

function ler() {
  try {
    const lista = JSON.parse(localStorage.getItem(CHAVE) ?? '[]');
    return Array.isArray(lista) ? lista.filter((j) => Number.isInteger(j?.jogo) && CODIGO.test(j?.codigo ?? '')) : [];
  } catch {
    return [];   // sem armazenamento (janela privada, dados bloqueados) ou conteúdo estragado
  }
}

function guardar(lista) {
  try {
    if (lista.length === 0) localStorage.removeItem(CHAVE);
    else localStorage.setItem(CHAVE, JSON.stringify(lista.slice(0, MAXIMO)));
  } catch { /* sem armazenamento: a lista só não fica */ }
}

/** Os jogos abertos neste dispositivo, o mais recente primeiro. */
export function jogosLembrados() {
  return ler();
}

/** Guarda (ou atualiza) um jogo: nomes das equipas e resultado da última vez que foi visto. */
export function lembrarJogo({ jogo, codigo, casa, fora, golosCasa, golosFora }) {
  const resto = ler().filter((j) => j.jogo !== jogo);
  guardar([{ jogo, codigo, casa, fora, golosCasa, golosFora, visto: new Date().toISOString() }, ...resto]);
}

export function esquecerJogo(jogo) {
  guardar(ler().filter((j) => j.jogo !== jogo));
}

export function esquecerTodos() {
  try { localStorage.removeItem(CHAVE); } catch { /* nada a fazer */ }
}
