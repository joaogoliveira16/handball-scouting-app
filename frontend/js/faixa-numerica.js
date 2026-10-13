// Faixa "Superioridade numérica": quem está em campo a menos, quanto falta a cada sanção e quem ataca em 7×6.
// Usada no banco (por baixo do marcador) e no dashboard (no topo).
import { h, substituir } from './dom.js';
import { situacaoAgora, formatarRestante } from './numerica.js';

/**
 * Desenha a faixa em `faixa` (e esconde-a se não se passa nada).
 * `jogo`: { casaId, foraId, casaNome, foraNome }; `segundo`: segundo de jogo agora.
 */
export function desenharFaixa(faixa, numerica, jogo, segundo) {
  const { casaId, foraId, casaNome, foraNome } = jogo;
  const situacao = situacaoAgora(numerica, casaId, foraId, segundo);
  faixa.hidden = !situacao;
  if (!situacao) { faixa.replaceChildren(); return; }

  const nomeDe = (id) => (id === casaId ? casaNome : foraNome);
  const ladoDe = (id) => (id === casaId ? 'casa' : 'fora');
  const titulo = situacao.rotulo
    ? [h('b', { class: 'rotulo-numerica' }, situacao.rotulo),
      h('span', { class: 'texto-numerica' }, situacao.favorecida ? `Superioridade · ${nomeDe(situacao.favorecida)}` : 'Igualdade numérica')]
    : [];
  substituir(faixa,
    ...titulo,
    situacao.ativas.map((s) => h('span', {
      class: `chip-numerica ${ladoDe(s.equipaId)}`,
      title: `${nomeDe(s.equipaId)} · ${s.tipo === 'VERMELHO' ? 'vermelho direto' : '2 minutos'}`,
    }, h('span', { class: `ponto-equipa ${ladoDe(s.equipaId)}` }),
    s.jogadorNumero != null ? `#${s.jogadorNumero} ` : '', h('b', {}, formatarRestante(s.restante)))),
    situacao.seteSeis.map((id) => h('span', { class: `chip-numerica sete-seis ${ladoDe(id)}`, title: 'Ataque sem guarda-redes' },
      h('span', { class: `ponto-equipa ${ladoDe(id)}` }), `7×6 · ${nomeDe(id)}`)));
}
