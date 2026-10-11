// Pedidos HTTP à API e pequenos utilitários partilhados pelas páginas.

export async function obter(url) {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(await mensagemDeErro(resposta));
  return resposta.json();
}

export async function enviar(metodo, url, corpo) {
  const resposta = await fetch(url, {
    method: metodo,
    headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  if (!resposta.ok) throw new Error(await mensagemDeErro(resposta));
  return resposta.status === 204 ? null : resposta.json();
}

async function mensagemDeErro(resposta) {
  try {
    const json = await resposta.json();
    if (json?.erro) return json.erro;
  } catch { /* resposta sem JSON */ }
  return `Erro ${resposta.status}`;
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

export const ROTULO_CORREDOR = {
  PONTA_ESQ: 'Ponta esquerda', LATERAL_ESQ: 'Lateral esquerdo', CENTRAL: 'Central',
  LATERAL_DIR: 'Lateral direito', PONTA_DIR: 'Ponta direita',
};
export const ORDEM_CORREDOR = ['PONTA_ESQ', 'LATERAL_ESQ', 'CENTRAL', 'LATERAL_DIR', 'PONTA_DIR'];

export const ROTULO_DISTANCIA = {
  ATE_6M: 'Até 6 m', DE_6_A_9M: '6 a 9 m', LINHA_9M: 'Linha de 9 m (9–11 m)', MAIS_9M: 'Mais de 11 m',
};
export const ORDEM_DISTANCIA = ['ATE_6M', 'DE_6_A_9M', 'LINHA_9M', 'MAIS_9M'];
