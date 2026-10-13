// O banco mostra logo o que o adjunto registou, mesmo antes de o servidor o confirmar (ou sem rede): junta às
// estatísticas que o servidor mandou os eventos que ainda estão na fila. Quando o servidor os confirma, passam a vir
// nas estatísticas dele e saem da fila. Não depende do browser: testa-se com node (tests/unidade/otimista.test.mjs).

const TIPOS_SANCAO = ['DOIS_MINUTOS', 'VERMELHO'];
const CAMPO_DO_RESULTADO = { DEFESA: 'defesas', FORA: 'fora', POSTE: 'poste', BLOQUEADO: 'bloqueados' };
const ZONAS_BALIZA_LINHA = ['ALTO', 'MEIO', 'BAIXO'];
const ZONAS_BALIZA_COLUNA = ['ESQ', 'CENTRO', 'DIR'];

/** Zona da baliza de um ponto (x e y em 0–100): a mesma regra de zonaBaliza em api.js, sem depender dele. */
function zonaDaBaliza(x, y) {
  const linha = ZONAS_BALIZA_LINHA[y < 100 / 3 ? 0 : y < 200 / 3 ? 1 : 2];
  const coluna = ZONAS_BALIZA_COLUNA[x < 100 / 3 ? 0 : x < 200 / 3 ? 1 : 2];
  return `${linha}_${coluna}`;
}

/** Estatísticas vazias de um jogo (para mostrar eventos pendentes antes de o servidor ter respondido alguma vez). */
export function estatisticasVazias(jogo) {
  const equipa = (equipaId, nome, eCasa) => ({
    equipaId, nome, eCasa, remates: 0, golos: 0, defesas: 0, fora: 0, poste: 0, bloqueados: 0, eficacia: null,
  });
  return {
    jogoId: jogo.id,
    equipas: [equipa(jogo.casaId, jogo.casaNome, true), equipa(jogo.foraId, jogo.foraNome, false)],
    sancoes: [],
    ultimosEventos: [],
    relogio: { segundo: 0, aCorrer: false },
    numerica: { relogioUsado: false, duracaoSegundos: 120, suspensoes: [], seteSeis: [], eficacia: [], tempo: [] },
  };
}

/** Os pendentes que o servidor ainda não tem (os que já aparecem nos últimos eventos dele foram confirmados há pouco). */
export function aindaPorConfirmar(estatisticas, pendentes) {
  const conhecidos = new Set((estatisticas?.ultimosEventos ?? []).map((e) => e.clienteId).filter(Boolean));
  return pendentes.filter((p) => !conhecidos.has(p.clienteId));
}

/**
 * Estatísticas do servidor + eventos pendentes, por ordem. Devolve um objeto novo (não mexe no original).
 * `contexto`: { jogo, tipos } (o jogo com os jogadores e a lista de tipos de evento, para dar nomes aos eventos).
 * Cada pendente é um item da fila: { clienteId, corpo }. Os eventos pendentes levam `pendente: true` e `id: null`.
 */
export function aplicarPendentes(estatisticas, pendentes, { jogo, tipos = [] }) {
  const base = estatisticas ?? estatisticasVazias(jogo);
  const novos = aindaPorConfirmar(base, pendentes);
  if (novos.length === 0) return base;

  const resultado = structuredClone(base);
  resultado.sancoes ??= [];
  resultado.ultimosEventos ??= [];
  resultado.numerica ??= estatisticasVazias(jogo).numerica;
  resultado.numerica.suspensoes ??= [];
  resultado.numerica.seteSeis ??= [];

  const nomeDoTipo = (codigo) => tipos.find((t) => t.codigo === codigo)?.nome ?? codigo;
  const nomeDaEquipa = (equipaId) => (equipaId === jogo.casaId ? jogo.casaNome : jogo.foraNome);

  novos.forEach((pendente, i) => {
    const e = pendente.corpo;
    const jogador = e.jogadorId != null ? jogo.jogadores?.find((j) => j.id === e.jogadorId) : null;
    const equipa = resultado.equipas.find((x) => x.equipaId === e.equipaId);

    // Remates: placar e contagens
    if (e.resultado && equipa) {
      equipa.remates += 1;
      if (e.resultado === 'GOLO') equipa.golos += 1;
      const campo = CAMPO_DO_RESULTADO[e.resultado];
      if (campo) equipa[campo] += 1;
      equipa.eficacia = Math.round((1000 * equipa.golos) / equipa.remates) / 10;
    }

    // Sanções: a contagem de 2 minutos e vermelhos por jogador, e a faixa de superioridade
    if (TIPOS_SANCAO.includes(e.tipoEvento) && e.jogadorId != null) {
      let sancao = resultado.sancoes.find((s) => s.jogadorId === e.jogadorId);
      if (!sancao) {
        sancao = {
          jogadorId: e.jogadorId, equipaId: e.equipaId, numero: jogador?.numero ?? 0, nome: jogador?.nome ?? '',
          doisMinutos: 0, vermelhos: 0, expulso: false,
        };
        resultado.sancoes.push(sancao);
      }
      if (e.tipoEvento === 'VERMELHO') sancao.vermelhos += 1;
      else sancao.doisMinutos += 1;
      sancao.expulso = sancao.vermelhos > 0 || sancao.doisMinutos >= 3;
    }
    if (TIPOS_SANCAO.includes(e.tipoEvento)) {
      resultado.numerica.suspensoes.push({
        eventoId: -(i + 1), equipaId: e.equipaId, jogadorId: e.jogadorId ?? null, jogadorNumero: jogador?.numero ?? null,
        tipo: e.tipoEvento, segundoJogo: e.segundoJogo,
      });
    }

    // 7×6: liga ou desliga o ataque da equipa
    if (e.tipoEvento === 'SETE_SEIS_INICIO' || e.tipoEvento === 'SETE_SEIS_FIM') {
      const ativo = e.tipoEvento === 'SETE_SEIS_INICIO';
      const estado = { equipaId: e.equipaId, ativo, desde: ativo ? e.segundoJogo : null };
      const existente = resultado.numerica.seteSeis.findIndex((s) => s.equipaId === e.equipaId);
      if (existente >= 0) resultado.numerica.seteSeis[existente] = estado;
      else resultado.numerica.seteSeis.push(estado);
    }

    // Só com o relógio usado (algum evento depois do segundo 0) se sabe quando houve sanções e 7×6
    if (e.segundoJogo > 0) resultado.numerica.relogioUsado = true;

    // O mais recente primeiro, como nos últimos eventos do servidor
    resultado.ultimosEventos.unshift({
      id: null,
      clienteId: pendente.clienteId,
      pendente: true,
      equipaId: e.equipaId,
      equipaNome: nomeDaEquipa(e.equipaId),
      tipo: e.tipoEvento,
      tipoNome: nomeDoTipo(e.tipoEvento),
      jogadorNumero: jogador?.numero ?? null,
      jogadorNome: jogador?.nome ?? null,
      resultado: e.resultado ?? null,
      situacao: e.situacao ?? 'POSICIONAL',
      balizaZona: e.balizaX != null && e.balizaY != null ? zonaDaBaliza(e.balizaX, e.balizaY) : null,
      parte: e.parte,
      segundoJogo: e.segundoJogo,
      criadoEm: pendente.criadoEm,
    });
  });

  return resultado;
}

/**
 * Só o que o banco usa das estatísticas, para guardar no tablet (e abrir o jogo sem rede): sem o mapa de remates
 * nem as tabelas, que são grandes e só o dashboard mostra.
 */
export function resumoParaGuardar(estatisticas) {
  if (!estatisticas) return null;
  const { jogoId, equipas, sancoes, ultimosEventos, relogio, numerica } = estatisticas;
  return { jogoId, equipas, sancoes, ultimosEventos, relogio, numerica };
}
