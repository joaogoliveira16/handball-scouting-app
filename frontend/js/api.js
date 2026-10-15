// Pedidos HTTP à API e pequenos utilitários partilhados pelas páginas.
import { irParaEntrar } from './conta.js';

/** Sessão terminada (401) fora das rotas da conta: volta à página de entrada. */
async function resposta401(resposta, url) {
  if (resposta.status === 401 && !url.startsWith('/api/conta')) await irParaEntrar();
}

export async function obter(url) {
  const resposta = await fetch(url);
  await resposta401(resposta, url);
  if (!resposta.ok) throw await erroDe(resposta);
  return resposta.json();
}

export async function enviar(metodo, url, corpo) {
  const resposta = await fetch(url, {
    method: metodo,
    headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  await resposta401(resposta, url);
  if (!resposta.ok) throw await erroDe(resposta);
  return resposta.status === 204 ? null : resposta.json();
}

/** Envia um ficheiro (por exemplo a imagem de um escudo) como corpo do pedido, sem JSON. */
export async function enviarFicheiro(metodo, url, ficheiro) {
  const resposta = await fetch(url, { method: metodo, headers: { 'Content-Type': ficheiro.type || 'application/octet-stream' }, body: ficheiro });
  await resposta401(resposta, url);
  if (!resposta.ok) throw await erroDe(resposta);
  return resposta.status === 204 ? null : resposta.json();
}

/** O erro de uma resposta falhada: a mensagem da API, o estado HTTP e, se houver, o código (ex.: email_por_confirmar). */
async function erroDe(resposta) {
  let json = null;
  try { json = await resposta.json(); } catch { /* resposta sem JSON */ }
  const erro = new Error(json?.erro || `Erro ${resposta.status}`);
  erro.status = resposta.status;
  erro.codigo = json?.codigo ?? null;
  return erro;
}

/** 125 segundos -> "02:05" */
export function formatarTempo(segundos) {
  const s = Math.max(0, Math.floor(segundos));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function percentagem(valor) {
  return valor == null ? '–' : `${Math.round(Number(valor))}%`;
}

export const RESULTADOS = ['GOLO', 'DEFESA', 'FORA', 'POSTE', 'BLOQUEADO'];

export const ROTULO_RESULTADO = {
  GOLO: 'Golo', DEFESA: 'Defesa', FORA: 'Fora', POSTE: 'Poste', BLOQUEADO: 'Bloqueado',
};

export const SITUACOES = [
  { codigo: 'POSICIONAL', rotulo: 'Posicional' },
  { codigo: 'CONTRA_ATAQUE', rotulo: 'Contra-ataque' },
  { codigo: 'SETE_METROS', rotulo: '7 metros' },
];

export const ROTULO_SITUACAO = Object.fromEntries(SITUACOES.map((s) => [s.codigo, s.rotulo]));

// A defesa que o adversário jogava num remate em ataque posicional (ver db/init/17_sistema_defensivo.sql)
export const SISTEMAS_DEFENSIVOS = [
  { codigo: '6_0', rotulo: '6:0' },
  { codigo: '5_1', rotulo: '5:1' },
  { codigo: '3_2_1', rotulo: '3:2:1' },
  { codigo: '4_2', rotulo: '4:2' },
  { codigo: 'INDIVIDUAL', rotulo: 'Individual' },
];
export const ROTULO_SISTEMA = Object.fromEntries(SISTEMAS_DEFENSIVOS.map((s) => [s.codigo, s.rotulo]));

export const ROTULO_CORREDOR = {
  PONTA_ESQ: 'Ponta esquerda', LATERAL_ESQ: 'Lateral esquerdo', CENTRAL: 'Central',
  LATERAL_DIR: 'Lateral direito', PONTA_DIR: 'Ponta direita',
};
export const ORDEM_CORREDOR = ['PONTA_ESQ', 'LATERAL_ESQ', 'CENTRAL', 'LATERAL_DIR', 'PONTA_DIR'];

export const ROTULO_DISTANCIA = {
  ATE_6M: 'Até 6 m', DE_6_A_9M: '6 a 9 m', LINHA_9M: 'Linha de 9 m (9–11 m)', MAIS_9M: 'Mais de 11 m',
};
export const ORDEM_DISTANCIA = ['ATE_6M', 'DE_6_A_9M', 'LINHA_9M', 'MAIS_9M'];

// Baliza (3 m x 2 m) vista de frente, do lado de quem remata, dividida em 3 x 3 zonas.
// Mesmas zonas e limites que a função zona_baliza da base de dados (db/init/06_baliza.sql).
export const ORDEM_ZONA_BALIZA = [
  'ALTO_ESQ', 'ALTO_CENTRO', 'ALTO_DIR', 'MEIO_ESQ', 'MEIO_CENTRO', 'MEIO_DIR', 'BAIXO_ESQ', 'BAIXO_CENTRO', 'BAIXO_DIR',
];
export const ROTULO_ZONA_BALIZA = {
  ALTO_ESQ: 'alto à esquerda', ALTO_CENTRO: 'alto ao centro', ALTO_DIR: 'alto à direita',
  MEIO_ESQ: 'meio à esquerda', MEIO_CENTRO: 'meio ao centro', MEIO_DIR: 'meio à direita',
  BAIXO_ESQ: 'baixo à esquerda', BAIXO_CENTRO: 'baixo ao centro', BAIXO_DIR: 'baixo à direita',
};

/** Zona da baliza de um ponto (x e y em 0–100): trave = 0, chão = 100; esquerda = 0, direita = 100. */
export function zonaBaliza(x, y) {
  const linha = y < 100 / 3 ? 'ALTO' : y < 200 / 3 ? 'MEIO' : 'BAIXO';
  const coluna = x < 100 / 3 ? 'ESQ' : x < 200 / 3 ? 'CENTRO' : 'DIR';
  return `${linha}_${coluna}`;
}

export const POSICOES = [
  { codigo: 'GR', rotulo: 'Guarda-redes' },
  { codigo: 'PE', rotulo: 'Ponta esquerda' },
  { codigo: 'LE', rotulo: 'Lateral esquerdo' },
  { codigo: 'CE', rotulo: 'Central' },
  { codigo: 'LD', rotulo: 'Lateral direito' },
  { codigo: 'PD', rotulo: 'Ponta direita' },
  { codigo: 'PV', rotulo: 'Pivot' },
];
export const ROTULO_POSICAO = Object.fromEntries(POSICOES.map((p) => [p.codigo, p.rotulo]));

/**
 * Ligação de descarga do Excel de um jogo (ou só de uma equipa, se equipaId for dado).
 * Quem abriu o jogo por um link de partilha passa o código; o dono usa a sessão.
 */
export function urlExcel(jogoId, equipaId = null, codigo = null) {
  const parametros = new URLSearchParams();
  if (equipaId != null) parametros.set('equipaId', equipaId);
  if (codigo) parametros.set('c', codigo);
  const texto = parametros.toString();
  return `/api/jogos/${jogoId}/exportar.xlsx${texto ? `?${texto}` : ''}`;
}

/** Ligação de partilha do dashboard em direto (qualquer pessoa com ela vê o jogo, sem conta). */
export function urlPartilha(jogoId, codigo) {
  return `${location.origin}/dashboard.html?jogo=${jogoId}&c=${encodeURIComponent(codigo)}`;
}

/** Acrescenta ?c=código a um endereço da API (quando se veio por link de partilha). */
export function comCodigo(url, codigo) {
  if (!codigo) return url;
  return `${url}${url.includes('?') ? '&' : '?'}c=${encodeURIComponent(codigo)}`;
}
