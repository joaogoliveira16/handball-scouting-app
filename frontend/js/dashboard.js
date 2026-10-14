// Dashboard em tempo real: o servidor envia o estado completo a cada evento registado.
import { h, substituir, avisar, copiarTexto } from './dom.js';
import {
  formatarTempo, percentagem, RESULTADOS, ROTULO_RESULTADO, ROTULO_SITUACAO,
  ROTULO_CORREDOR, ORDEM_CORREDOR, ROTULO_DISTANCIA, ORDEM_DISTANCIA, ROTULO_ZONA_BALIZA, urlExcel, urlPartilha, obter,
} from './api.js';
import { criarCampo, novoSvgCampo, simboloLegenda } from './campo.js';
import { criarBaliza, novoSvgBaliza } from './baliza.js';
import { ligar, TEXTO_ESTADO } from './tempo-real.js';
import { obterConta, mostrarMenu } from './conta.js';
import { lembrarJogo } from './vistos.js';
import { escudo } from './escudo.js';
import { desenharFaixa } from './faixa-numerica.js';
import { segundoAgora, SITUACOES_NUMERICAS, ROTULO_SITUACAO_NUMERICA } from './numerica.js';

const parametros = new URLSearchParams(location.search);
const jogoId = Number(parametros.get('jogo'));
let codigo = parametros.get('c');   // código do link de partilha (quem não tem conta entra só com ele)
if (!jogoId) location.replace('./');

const TIMEOUTS_POR_JOGO = 3;          // as regras da IHF (o servidor aplica os mesmos números)

const estado = {
  dados: null,
  recebidoEm: 0,                        // quando chegou o estado (o relógio do jogo avança a partir daí)
  eDono: false,                         // só o dono do jogo vê o treinador-assistente
  equipaId: null,                       // equipa mostrada no mapa e nas tabelas
  filtros: new Set(RESULTADOS),         // resultados visíveis no mapa
};

const painel = document.getElementById('painel');

// ---------------------------------------------------------------------
// Pequenos auxiliares
// ---------------------------------------------------------------------
const ladoDe = (equipa) => (equipa.eCasa ? 'casa' : 'fora');
const equipaPorId = (id) => estado.dados.equipas.find((e) => e.equipaId === id);
const pontoEquipa = (equipa) => h('span', { class: `ponto-equipa ${ladoDe(equipa)}` });

function barra(valor, lado) {
  return h('div', { class: `barra ${lado ?? ''}` }, h('i', { style: `width:${Math.min(100, Number(valor) || 0)}%` }));
}

function cartao(titulo, ...conteudo) {
  return h('section', { class: 'cartao' }, h('h2', { style: 'margin-top:0' }, titulo), ...conteudo);
}

function numero(valor, rotulo) {
  return h('div', { class: 'numero' }, h('b', {}, valor), h('span', {}, rotulo));
}

function tabela(cabecalho, linhas) {
  return h('table', { class: 'tabela' },
    h('thead', {}, h('tr', {}, cabecalho.map(([texto, numerica]) => h('th', { class: numerica ? 'num' : '' }, texto)))),
    h('tbody', {}, linhas));
}

// ---------------------------------------------------------------------
// Blocos do dashboard
// ---------------------------------------------------------------------
/**
 * Treinador-assistente: sugestões calculadas pelo servidor a partir dos dados do jogo (série de golos, parcial, sanções,
 * jogadores, guarda-redes, superioridade...). Só o dono do jogo as vê: é ele quem decide, a equipa de adeptos não precisa delas.
 */
function blocoAssistente() {
  const assistente = estado.dados.assistente;
  if (!estado.eDono || !assistente) return null;
  const sugestoes = assistente.sugestoes ?? [];

  const timeouts = (assistente.timeouts ?? []).map((t) => {
    const equipa = equipaPorId(t.equipaId);
    const podePedir = t.restantes > 0 ? `pode pedir ${t.restantes}` : 'sem time-outs agora';
    return h('span', { class: 'timeouts-equipa', 'data-equipa': t.equipaId },
      pontoEquipa(equipa), h('b', {}, equipa.nome), ` ${t.usados}/${TIMEOUTS_POR_JOGO} usados · ${podePedir}`);
  });

  return h('section', { class: 'cartao assistente largo', 'data-assistente': '' },
    h('h2', { style: 'margin-top:0' }, 'Treinador-assistente'),
    h('div', { class: 'timeouts' }, h('span', { class: 'suave' }, 'Time-outs'), timeouts),
    sugestoes.length
      ? h('ul', { class: 'sugestoes' }, sugestoes.map((s) => {
        const equipa = s.equipaId != null ? equipaPorId(s.equipaId) : null;
        return h('li', { class: `sugestao ${s.nivel}`, 'data-codigo': s.codigo, 'data-nivel': s.nivel },
          h('div', { class: 'sugestao-titulo' }, equipa ? pontoEquipa(equipa) : null, s.titulo),
          h('div', { class: 'sugestao-detalhe' }, s.detalhe));
      }))
      : h('p', { class: 'vazio', style: 'margin:8px 0 0' }, 'Sem sugestões por agora. Aparecem quando os números o justificam.'),
    h('p', { class: 'vazio assistente-nota' },
      'Sugestões automáticas a partir das estatísticas do jogo. A decisão é sempre do treinador.'));
}

function blocoEficacia() {
  return cartao('Eficácia de remate', h('div', { class: 'cartoes-equipa' }, estado.dados.equipas.map((e) =>
    h('div', { class: 'equipa-resumo' },
      h('h3', {}, pontoEquipa(e), e.nome),
      h('div', { class: 'numeros' },
        numero(e.remates, 'remates'), numero(e.golos, 'golos'), numero(percentagem(e.eficacia), 'eficácia')),
      barra(e.eficacia, ladoDe(e)),
      h('div', { class: 'meta-equipa' },
        `${e.defesas} defesas · ${e.fora} fora · ${e.poste} poste · ${e.bloqueados} bloqueados`)))));
}

function blocoParcial() {
  const { parcial, parcialMinutos } = estado.dados;
  return cartao(`Últimos ${parcialMinutos} minutos`, h('div', { class: 'cartoes-equipa' }, parcial.map((p) => {
    const equipa = equipaPorId(p.equipaId);
    return h('div', { class: 'equipa-resumo' },
      h('h3', {}, pontoEquipa(equipa), p.nome),
      h('div', { class: 'numeros' }, numero(p.golos, 'golos'), numero(p.remates, 'remates')));
  })));
}

function blocoMapa(selecionada) {
  const svgCampo = novoSvgCampo(); // h('svg') criaria um elemento HTML, que o browser não desenha
  const remates = estado.dados.remates.filter((r) => r.equipaId === selecionada.equipaId);
  const visiveis = remates.filter((r) => estado.filtros.has(r.resultado));
  const filtros = RESULTADOS.map((r) => h('button', {
    type: 'button', 'data-resultado': r,
    class: `filtro${estado.filtros.has(r) ? ' ativo' : ''}`,
    onclick: () => {
      if (estado.filtros.has(r)) estado.filtros.delete(r); else estado.filtros.add(r);
      desenhar();
    },
  }, `${ROTULO_RESULTADO[r]} (${remates.filter((x) => x.resultado === r).length})`));

  const cartaoMapa = cartao(`Mapa de remates · ${selecionada.nome}`,
    h('div', { class: 'separador-abas' }, filtros),
    h('div', { class: 'mapa-dash' }, svgCampo),
    h('div', { class: 'legenda' }, RESULTADOS.map((r) => h('span', {}, simboloLegenda(r), ROTULO_RESULTADO[r]))),
    h('p', { class: 'vazio', style: 'text-align:center' }, `${visiveis.length} de ${remates.length} remates visíveis`));
  cartaoMapa.classList.add('largo');
  criarCampo(svgCampo).marcadores(visiveis);
  return cartaoMapa;
}

/** Textos e cor de cada baliza do dashboard: onde o guarda-redes adversário defendeu e onde entraram os golos. */
const BALIZA_DASH = {
  DEFESA: {
    titulo: 'Defesas na baliza', rgb: '124, 58, 237', singular: 'defesa', plural: 'defesas', maior: 'Mais defesas', vazio: 'Ainda sem defesas.',
    intro: (equipa, adversaria) => `Remates de ${equipa} defendidos por ${adversaria}.`,
  },
  GOLO: {
    titulo: 'Golos na baliza', rgb: '22, 163, 74', singular: 'golo', plural: 'golos', maior: 'Mais golos', vazio: 'Ainda sem golos.',
    intro: (equipa, adversaria) => `Onde entraram os golos de ${equipa} na baliza de ${adversaria}.`,
  },
};

/** O local na baliza (vista de quem remata) das defesas ou dos golos da equipa escolhida. */
function blocoBaliza(selecionada, resultado) {
  const texto = BALIZA_DASH[resultado];
  const remates = estado.dados.remates.filter((r) => r.equipaId === selecionada.equipaId && r.resultado === resultado);
  const comLocal = remates.filter((r) => r.balizaX != null && r.balizaY != null);
  const adversaria = estado.dados.equipas.find((e) => e.equipaId !== selecionada.equipaId);

  const porZona = {};
  for (const r of comLocal) porZona[r.balizaZona] = (porZona[r.balizaZona] ?? 0) + 1;

  const svgBaliza = novoSvgBaliza();
  const semLocal = remates.length - comLocal.length;
  const resumo = remates.length === 0
    ? texto.vazio
    : `${comLocal.length} de ${remates.length} ${remates.length === 1 ? texto.singular : texto.plural} com local marcado${semLocal ? ` (${semLocal} sem local)` : ''}.`;

  // a zona mais atacada, para ler o mapa de relance
  const [zonaTop, totalTop] = Object.entries(porZona).sort((a, b) => b[1] - a[1])[0] ?? [];

  const cartaoBaliza = cartao(`${texto.titulo} · ${selecionada.nome}`,
    h('p', { class: 'vazio', style: 'margin:0 0 8px' }, texto.intro(selecionada.nome, adversaria.nome)),
    h('div', { class: 'baliza-dash', 'data-resultado': resultado }, svgBaliza),
    h('p', { class: 'vazio', style: 'text-align:center' }, resumo),
    zonaTop
      ? h('p', { class: 'zona-top' }, `${texto.maior}: `, h('b', {}, ROTULO_ZONA_BALIZA[zonaTop]), ` (${totalTop})`)
      : null,
    h('p', { class: 'vazio', style: 'text-align:center;font-size:0.85rem' }, 'Baliza vista de frente, do lado de quem remata.'));
  const baliza = criarBaliza(svgBaliza);
  baliza.contagens(porZona, texto.rgb);
  baliza.marcadores(comLocal, resultado);
  return cartaoBaliza;
}

function blocoJogadores(selecionada) {
  const linhas = estado.dados.jogadores
    .filter((j) => j.equipaId === selecionada.equipaId)
    .map((j) => h('tr', {},
      h('td', {}, `#${j.numero} ${j.nome}`),
      h('td', {}, j.posicao),
      h('td', { class: 'num' }, j.remates),
      h('td', { class: 'num' }, j.golos),
      h('td', { class: 'num' }, percentagem(j.eficacia)),
      h('td', { class: 'barra-celula' }, barra(j.eficacia, ladoDe(selecionada)))));
  return cartao(`Jogadores · ${selecionada.nome}`, linhas.length
    ? tabela([['Jogador'], ['Pos.'], ['Rem.', true], ['Golos', true], ['%', true], ['']], linhas)
    : h('p', { class: 'vazio' }, 'Ainda sem remates.'));
}

function blocoZonas(titulo, dados, ordem, rotulos, selecionada) {
  const porZona = new Map(dados.filter((z) => z.equipaId === selecionada.equipaId).map((z) => [z.zona, z]));
  const linhas = ordem.map((zona) => {
    const z = porZona.get(zona);
    return h('tr', {},
      h('td', {}, rotulos[zona]),
      h('td', { class: 'num' }, z?.remates ?? '–'),
      h('td', { class: 'num' }, z?.golos ?? '–'),
      h('td', { class: 'num' }, percentagem(z?.eficacia)),
      h('td', { class: 'barra-celula' }, barra(z?.eficacia, ladoDe(selecionada))));
  });
  return cartao(`${titulo} · ${selecionada.nome}`,
    tabela([['Zona'], ['Rem.', true], ['Golos', true], ['%', true], ['']], linhas));
}

function blocoPorParte() {
  const linhas = estado.dados.equipas.flatMap((e) => [1, 2].map((parte) => {
    const p = estado.dados.porParte.find((x) => x.equipaId === e.equipaId && x.parte === parte);
    return h('tr', {},
      h('td', {}, pontoEquipa(e), e.nome),
      h('td', {}, `${parte}.ª parte`),
      h('td', { class: 'num' }, p?.remates ?? '–'),
      h('td', { class: 'num' }, p?.golos ?? '–'),
      h('td', { class: 'num' }, percentagem(p?.eficacia)));
  }));
  return cartao('Por parte', tabela([['Equipa'], ['Parte'], ['Rem.', true], ['Golos', true], ['%', true]], linhas));
}

function blocoGuardaRedes() {
  const linhas = estado.dados.guardaRedes.map((g) => h('tr', {},
    h('td', {}, pontoEquipa(equipaPorId(g.equipaId)), `#${g.numero} ${g.nome}`),
    h('td', { class: 'num' }, g.rematesBaliza),
    h('td', { class: 'num' }, g.defesas),
    h('td', { class: 'num' }, g.golosSofridos),
    h('td', { class: 'num' }, percentagem(g.percentagemDefesa))));
  return cartao('Guarda-redes', linhas.length
    ? tabela([['Guarda-redes'], ['À baliza', true], ['Defesas', true], ['Golos', true], ['% def.', true]], linhas)
    : h('p', { class: 'vazio' }, 'Ainda sem remates à baliza.'));
}

function blocoOutrosEventos() {
  const tipos = new Map();
  for (const o of estado.dados.outrosEventos) {
    if (!tipos.has(o.tipo)) tipos.set(o.tipo, { nome: o.nome, total: {} });
    tipos.get(o.tipo).total[o.equipaId] = o.total;
  }
  const [casa, fora] = estado.dados.equipas;
  const linhas = [...tipos.values()].map((t) => h('tr', {},
    h('td', {}, t.nome),
    h('td', { class: 'num' }, t.total[casa.equipaId] ?? 0),
    h('td', { class: 'num' }, t.total[fora.equipaId] ?? 0)));
  return cartao('Outros eventos', linhas.length
    ? tabela([[''], [casa.nome, true], [fora.nome, true]], linhas)
    : h('p', { class: 'vazio' }, 'Ainda sem faltas, perdas de bola ou exclusões.'));
}

/** Quem já viu 2 minutos ou vermelho; "Expulso" = vermelho direto ou 3.º 2 minutos (os remates que fez continuam contados). */
function blocoSancoes() {
  const sancoes = estado.dados.sancoes ?? [];
  if (!sancoes.length) return null;
  const linhas = sancoes.map((s) => h('tr', {},
    h('td', {}, pontoEquipa(equipaPorId(s.equipaId)), `#${s.numero} ${s.nome}`),
    h('td', { class: 'num' }, s.doisMinutos),
    h('td', { class: 'num' }, s.vermelhos),
    h('td', {}, s.expulso ? h('span', { class: 'etiqueta expulso' }, 'Expulso') : '')));
  return cartao('Sanções', tabela([['Jogador'], ['2 min', true], ['Vermelhos', true], ['']], linhas));
}

// Situação do adversário que é o "espelho" da minha: os golos que ele marca aí são os que eu sofro
const ESPELHO_NUMERICO = {
  SUPERIORIDADE: 'INFERIORIDADE', INFERIORIDADE: 'SUPERIORIDADE', IGUALDADE: 'IGUALDADE',
  SETE_SEIS: 'BALIZA_VAZIA', BALIZA_VAZIA: 'SETE_SEIS',
};

/** Eficácia da equipa escolhida em superioridade, igualdade, inferioridade e nos ataques 7×6, com os golos sofridos e o tempo. */
function blocoNumerica(selecionada) {
  const n = estado.dados.numerica;
  if (!n) return null;
  const titulo = `Superioridade numérica · ${selecionada.nome}`;
  if (!n.relogioUsado) {
    return n.suspensoes.length
      ? cartao(titulo, h('p', { class: 'vazio' }, 'Já houve 2 minutos ou vermelhos, mas o relógio do banco não foi usado: sem o minuto de cada evento não se sabe quando houve superioridade.'))
      : null;
  }
  const adversaria = estado.dados.equipas.find((e) => e.equipaId !== selecionada.equipaId);
  const eficacia = (equipa, situacao) => n.eficacia.find((e) => e.equipaId === equipa.equipaId && e.situacao === situacao);
  const segundos = (equipa, situacao) => n.tempo.find((t) => t.equipaId === equipa.equipaId && t.situacao === situacao)?.segundos;
  if (!n.suspensoes.length && !n.tempo.length && !n.eficacia.some((e) => e.situacao !== 'IGUALDADE')) return null;

  const linhas = SITUACOES_NUMERICAS.map((situacao) => {
    const meu = eficacia(selecionada, situacao);
    const contra = eficacia(adversaria, ESPELHO_NUMERICO[situacao]);
    // contra uma baliza vazia, o tempo é o que o adversário passou em 7×6; a igualdade não tem tempo próprio
    const tempo = situacao === 'BALIZA_VAZIA' ? segundos(adversaria, 'SETE_SEIS') : situacao === 'IGUALDADE' ? null : segundos(selecionada, situacao);
    return h('tr', { 'data-situacao': situacao },
      h('td', {}, ROTULO_SITUACAO_NUMERICA[situacao]),
      h('td', { class: 'num' }, meu?.remates ?? '–'),
      h('td', { class: 'num' }, meu?.golos ?? '–'),
      h('td', { class: 'num' }, meu ? percentagem((100 * meu.golos) / meu.remates) : '–'),
      h('td', { class: 'num' }, meu || contra ? (contra?.golos ?? 0) : '–'),
      h('td', { class: 'num' }, tempo ? formatarTempo(tempo) : '–'));
  });
  return cartao(titulo,
    tabela([['Situação'], ['Rem.', true], ['Golos', true], ['%', true], ['Sofr.', true], ['Tempo', true]], linhas),
    h('p', { class: 'vazio', style: 'font-size:0.85rem;margin:8px 0 0' },
      'Superioridade: o adversário tem menos jogadores em campo (2 minutos ou vermelho). "Sofr." são os golos do adversário na situação contrária. Sem os 7 metros.'));
}

function blocoUltimosEventos() {
  const eventos = estado.dados.ultimosEventos.slice(0, 10);
  const lista = eventos.map((e) => {
    const equipa = equipaPorId(e.equipaId);
    const quem = e.jogadorNumero != null ? `#${e.jogadorNumero} ${e.jogadorNome}` : '';
    const situacao = e.resultado && e.situacao !== 'POSICIONAL' ? ` (${ROTULO_SITUACAO[e.situacao]})` : '';
    return h('li', {},
      h('span', { class: 'hora' }, `${e.parte}.ª ${formatarTempo(e.segundoJogo)}`),
      h('span', { class: 'texto' },
        pontoEquipa(equipa),
        e.resultado
          ? h('span', { class: 'etiqueta', 'data-resultado': e.resultado }, ROTULO_RESULTADO[e.resultado])
          : h('span', { class: 'etiqueta neutra' }, e.tipoNome),
        ` ${quem}${situacao}`,
        e.balizaZona ? h('span', { class: 'zona-baliza' }, ` · ${ROTULO_ZONA_BALIZA[e.balizaZona]}`) : null));
  });
  return cartao('Últimos eventos', lista.length
    ? h('ol', { class: 'lista-eventos' }, lista)
    : h('p', { class: 'vazio' }, 'Ainda sem eventos.'));
}

// ---------------------------------------------------------------------
// Desenho completo
// ---------------------------------------------------------------------
function desenharPlacar() {
  const [casa, fora] = estado.dados.equipas;
  document.getElementById('nome-casa').textContent = casa.nome;
  document.getElementById('nome-fora').textContent = fora.nome;
  substituir(document.getElementById('escudo-casa'), escudo(casa.equipaId, casa.escudo, 'placar'));
  substituir(document.getElementById('escudo-fora'), escudo(fora.equipaId, fora.escudo, 'placar'));
  document.getElementById('golos-casa').textContent = casa.golos;
  document.getElementById('golos-fora').textContent = fora.golos;
  document.title = `${casa.golos}–${fora.golos} · ${casa.nome} vs ${fora.nome}`;
}

function desenhar() {
  if (!estado.dados) return;
  desenharPlacar();

  const equipas = estado.dados.equipas;
  if (!equipas.some((e) => e.equipaId === estado.equipaId)) estado.equipaId = equipas[0].equipaId;
  const selecionada = equipaPorId(estado.equipaId);

  const abas = h('div', { class: 'separador-abas largo' },
    equipas.map((e) => h('button', {
      type: 'button', class: e.equipaId === estado.equipaId ? 'ativo' : '',
      onclick: () => { estado.equipaId = e.equipaId; desenhar(); },
    }, `Ver: ${e.nome}`)),
    h('div', { class: 'exportar' },
      h('a', { class: 'botao-link pequeno', href: urlExcel(jogoId, selecionada.equipaId, codigo), download: '' }, `⬇ Excel · ${selecionada.nome}`),
      h('a', { class: 'botao-link suave pequeno', href: urlExcel(jogoId, null, codigo), download: '' }, '⬇ Excel · jogo completo')));

  const dados = estado.dados;
  faixaNumerica = h('div', { class: 'faixa-numerica largo', hidden: true });
  substituir(painel,
    faixaNumerica,
    blocoAssistente(),
    blocoEficacia(),
    blocoParcial(),
    abas,
    blocoMapa(selecionada),
    blocoBaliza(selecionada, 'GOLO'),
    blocoBaliza(selecionada, 'DEFESA'),
    blocoJogadores(selecionada),
    blocoNumerica(selecionada),
    blocoZonas('Por corredor', dados.porCorredor, ORDEM_CORREDOR, ROTULO_CORREDOR, selecionada),
    blocoZonas('Por distância', dados.porDistancia, ORDEM_DISTANCIA, ROTULO_DISTANCIA, selecionada),
    blocoPorParte(),
    blocoGuardaRedes(),
    blocoOutrosEventos(),
    blocoSancoes(),
    blocoUltimosEventos());
  atualizarRelogio();
}

// ---------------------------------------------------------------------
// Relógio do jogo e faixa de superioridade (avançam a cada segundo entre dois estados do servidor)
// ---------------------------------------------------------------------
let faixaNumerica = null;

function atualizarRelogio() {
  const el = document.getElementById('relogio-dash');
  const dados = estado.dados;
  if (!dados) return;
  const segundo = segundoAgora(dados.relogio, estado.recebidoEm);
  el.hidden = !dados.numerica?.relogioUsado;
  el.textContent = formatarTempo(segundo);
  el.classList.toggle('parado', !dados.relogio?.aCorrer);
  if (faixaNumerica) {
    const [casa, fora] = dados.equipas;
    desenharFaixa(faixaNumerica, dados.numerica, { casaId: casa.equipaId, foraId: fora.equipaId, casaNome: casa.nome, foraNome: fora.nome }, segundo);
  }
}
setInterval(atualizarRelogio, 500);

function receber(dados) {
  estado.dados = dados;
  estado.recebidoEm = Date.now();
  desenhar();
  lembrarComoConvidado(dados);
}

/** Quem veio só pelo link (sem conta) fica com o jogo na sua lista da área de convidado, neste dispositivo. */
function lembrarComoConvidado(dados) {
  if (conta || !codigo || dados.equipas.length !== 2) return;
  const [casa, fora] = dados.equipas;
  lembrarJogo({ jogo: jogoId, codigo, casa: casa.nome, fora: fora.nome, golosCasa: casa.golos, golosFora: fora.golos });
}

/** Link inválido, jogo que não existe ou que já não é visível para esta pessoa. */
function mostrarSemAcesso(conta) {
  document.title = 'Jogo indisponível · Scouting de Andebol';
  document.querySelector('.placar').hidden = true;
  document.getElementById('partilhar').hidden = true;
  document.getElementById('excel-jogo').hidden = true;
  substituir(document.querySelector('main'),
    h('section', { class: 'sem-acesso' },
      h('h1', {}, 'Este jogo não está disponível'),
      h('p', {}, conta
        ? 'O jogo não existe ou não é teu. Se recebeste um link, pede um novo a quem o partilhou.'
        : 'O jogo foi escondido, já passaram mais de 24 horas ou o link está incompleto. Vê os jogos de hoje ou pede um link novo a quem o partilhou. Se o jogo é teu, entra na tua conta.'),
      conta
        ? h('a', { class: 'botao-link primario', href: './' }, 'Ver os meus jogos')
        : h('div', { class: 'acoes-formulario' },
          h('a', { class: 'botao-link primario', href: 'convidado.html' }, 'Área de convidado'),
          h('a', { class: 'botao-link', href: `entrar.html?voltar=${encodeURIComponent(`dashboard.html${location.search}`)}` }, 'Entrar na minha conta'))));
}

let conta = null;

function mostrarEstadoLigacao(estadoLigacao) {
  const el = document.getElementById('ligacao');
  el.className = `ligacao ${estadoLigacao === 'ligado' ? 'ok' : estadoLigacao}`;
  el.textContent = TEXTO_ESTADO[estadoLigacao];
  if (estadoLigacao === 'negado') mostrarSemAcesso(conta);
}

async function copiarLink() {
  const link = urlPartilha(jogoId, codigo);
  if (await copiarTexto(link)) avisar('Link copiado. Quem o abrir vê este jogo em direto, sem conta.');
  else window.prompt('Copia este link para partilhar o jogo em direto:', link);
}

// Quem tem conta volta à lista de jogos e pode copiar o link; quem veio só pelo link (convidado) volta à área de
// convidado, vê o jogo e pode exportar
try {
  conta = await obterConta();
} catch { /* sem resposta da API: segue como convidado */ }

const seta = document.getElementById('voltar');
if (!conta) {
  seta.href = 'convidado.html';
  seta.setAttribute('aria-label', 'Voltar à área de convidado');
}
seta.hidden = false;

if (conta) {
  mostrarMenu(conta);
  // O servidor só entrega o código de partilha ao dono: é assim que se sabe se este jogo é dele. Quem abriu o link de
  // outra pessoa (mesmo com conta) vê o jogo, mas sem o treinador-assistente.
  try {
    const jogo = await obter(`/api/jogos/${jogoId}${codigo ? `?c=${encodeURIComponent(codigo)}` : ''}`);
    estado.eDono = Boolean(jogo.codigo);
    codigo ??= jogo.codigo;   // aberto sem código (ex.: um marcador antigo): o dono vai buscá-lo ao jogo
  } catch { /* sem resposta: segue sem o assistente */ }
}
if (codigo) {
  const botaoPartilhar = document.getElementById('partilhar');
  botaoPartilhar.hidden = false;
  botaoPartilhar.addEventListener('click', copiarLink);
}

document.getElementById('excel-jogo').href = urlExcel(jogoId, null, codigo);

ligar(jogoId, codigo, receber, mostrarEstadoLigacao);
