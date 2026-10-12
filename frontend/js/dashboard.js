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

const parametros = new URLSearchParams(location.search);
const jogoId = Number(parametros.get('jogo'));
let codigo = parametros.get('c');   // código do link de partilha (quem não tem conta entra só com ele)
if (!jogoId) location.replace('./');

// Diferença de golos no parcial a partir da qual se sugere um time-out
const LIMIAR_PARCIAL = 3;

const estado = {
  dados: null,
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
function blocoAlerta() {
  const [a, b] = estado.dados.parcial;
  if (!a || !b) return null;
  const diferenca = a.golos - b.golos;
  if (Math.abs(diferenca) < LIMIAR_PARCIAL) return null;
  const [lider, atras] = diferenca > 0 ? [a, b] : [b, a];
  return h('div', { class: 'alerta-parcial largo' },
    `Parcial de ${lider.golos}–${atras.golos} para ${lider.nome} nos últimos ${estado.dados.parcialMinutos} minutos. `,
    `Momento a considerar para um time-out de ${atras.nome}.`);
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

/** Onde o guarda-redes adversário defendeu os remates da equipa escolhida (baliza vista de quem remata). */
function blocoBaliza(selecionada) {
  const defesas = estado.dados.remates.filter((r) => r.equipaId === selecionada.equipaId && r.resultado === 'DEFESA');
  const comLocal = defesas.filter((r) => r.balizaX != null && r.balizaY != null);
  const adversaria = estado.dados.equipas.find((e) => e.equipaId !== selecionada.equipaId);

  const porZona = {};
  for (const r of comLocal) porZona[r.balizaZona] = (porZona[r.balizaZona] ?? 0) + 1;

  const svgBaliza = novoSvgBaliza();
  const semLocal = defesas.length - comLocal.length;
  const resumo = defesas.length === 0
    ? 'Ainda sem defesas.'
    : `${comLocal.length} de ${defesas.length} ${defesas.length === 1 ? 'defesa' : 'defesas'} com local marcado${semLocal ? ` (${semLocal} sem local)` : ''}.`;

  // a zona mais atacada, para ler o mapa de relance
  const [zonaTop, totalTop] = Object.entries(porZona).sort((a, b) => b[1] - a[1])[0] ?? [];

  const cartaoBaliza = cartao(`Defesas na baliza · ${selecionada.nome}`,
    h('p', { class: 'vazio', style: 'margin:0 0 8px' }, `Remates de ${selecionada.nome} defendidos por ${adversaria.nome}.`),
    h('div', { class: 'baliza-dash' }, svgBaliza),
    h('p', { class: 'vazio', style: 'text-align:center' }, resumo),
    zonaTop
      ? h('p', { class: 'zona-top' }, 'Mais defesas: ', h('b', {}, ROTULO_ZONA_BALIZA[zonaTop]), ` (${totalTop})`)
      : null,
    h('p', { class: 'vazio', style: 'text-align:center;font-size:0.85rem' }, 'Baliza vista de frente, do lado de quem remata.'));
  const baliza = criarBaliza(svgBaliza);
  baliza.contagens(porZona);
  baliza.marcadores(comLocal);
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
  substituir(painel,
    blocoAlerta(),
    blocoEficacia(),
    blocoParcial(),
    abas,
    blocoMapa(selecionada),
    blocoBaliza(selecionada),
    blocoJogadores(selecionada),
    blocoZonas('Por corredor', dados.porCorredor, ORDEM_CORREDOR, ROTULO_CORREDOR, selecionada),
    blocoZonas('Por distância', dados.porDistancia, ORDEM_DISTANCIA, ROTULO_DISTANCIA, selecionada),
    blocoPorParte(),
    blocoGuardaRedes(),
    blocoOutrosEventos(),
    blocoUltimosEventos());
}

function receber(dados) {
  estado.dados = dados;
  desenhar();
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
        : 'O link está incompleto ou o jogo já não existe. Pede um link novo a quem o partilhou. Se o jogo é teu, entra na tua conta.'),
      conta
        ? h('a', { class: 'botao-link primario', href: './' }, 'Ver os meus jogos')
        : h('a', { class: 'botao-link primario', href: `entrar.html?voltar=${encodeURIComponent(`dashboard.html${location.search}`)}` }, 'Entrar na minha conta')));
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

// Quem tem conta vê a seta de voltar e o botão de partilha; quem veio só pelo link vê o jogo e pode exportar
try {
  conta = await obterConta();
} catch { /* sem resposta da API: segue como visitante */ }

if (conta) {
  mostrarMenu(conta);
  document.getElementById('voltar').hidden = false;
  if (!codigo) {
    // Aberto sem código (ex.: um marcador antigo): o dono vai buscá-lo ao jogo
    try { codigo = (await obter(`/api/jogos/${jogoId}`)).codigo; } catch { /* não é o dono: sem botão */ }
  }
}
if (codigo) {
  const botaoPartilhar = document.getElementById('partilhar');
  botaoPartilhar.hidden = false;
  botaoPartilhar.addEventListener('click', copiarLink);
}

document.getElementById('excel-jogo').href = urlExcel(jogoId, null, codigo);

ligar(jogoId, codigo, receber, mostrarEstadoLigacao);
