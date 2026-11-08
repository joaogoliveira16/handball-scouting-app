// Relatório do intervalo: os 3 pontos a corrigir na 2.ª parte, o que manter e os números da 1.ª, para o treinador
// ver no tablet, imprimir ou copiar como texto. As contas estão em relatorio-intervalo.js; aqui só se desenha.
import { h, substituir, avisar, copiarTexto } from './dom.js';
import { obter } from './api.js';
import { ligar, TEXTO_ESTADO } from './tempo-real.js';
import { obterConta } from './conta.js';
import { escudo } from './escudo.js';
import { relatorioIntervalo, textoRelatorio, avisoPoucosDados, semPontosACorrigir, palavrasDaParte, JOGO_TODO } from './relatorio-intervalo.js';

const parametros = new URLSearchParams(location.search);
const jogoId = Number(parametros.get('jogo'));
const codigo = parametros.get('c');   // código do link de partilha (quem não tem conta entra só com ele)
const equipaPedida = Number(parametros.get('equipa')) || null;   // a equipa que se via no dashboard
if (!jogoId) location.replace('./');

// A parte pedida no endereço: 1, 2... ou «jogo» para o relatório do jogo todo (o que o banco abre ao fim do jogo)
const partePedida = parametros.get('parte') === 'jogo' ? JOGO_TODO : (Math.floor(Number(parametros.get('parte'))) || 1);

const estado = {
  dados: null,
  equipaId: equipaPedida,   // a equipa do relatório («nós»)
  parte: partePedida,
  equipaDaConta: null,      // a equipa da conta, para abrir o relatório já do lado certo
  relatorio: null,
};

const raiz = document.getElementById('intervalo');
const botaoCopiar = document.getElementById('copiar');
const botaoImprimir = document.getElementById('imprimir');

const ladoDe = (equipa) => (equipa.eCasa ? 'casa' : 'fora');
const pontoEquipa = (equipa) => h('span', { class: `ponto-equipa ${ladoDe(equipa)}` });

// ---------------------------------------------------------------------
// Blocos da folha
// ---------------------------------------------------------------------
function cabecalho(rel, casa, fora) {
  const lado = (equipa, golos) => [
    h('span', { class: 'folha-escudo' }, escudo(equipa.equipaId, equipa.escudo, 'placar')),
    h('span', { class: `folha-equipa ${ladoDe(equipa)}` }, equipa.nome),
    h('strong', {}, golos),
  ];
  const golosDe = (equipa) => (equipa.equipaId === rel.nos.equipaId ? rel.golos.nos : rel.golos.eles);
  return h('header', { class: 'folha-cabeca' },
    h('div', { class: 'folha-placar' }, lado(casa, golosDe(casa)), h('span', { class: 'folha-traco' }, '–'), lado(fora, golosDe(fora)).reverse()),
    h('p', { class: 'folha-sub' }, rel.parte === JOGO_TODO
      ? `Fim do jogo · relatório do jogo todo para ${rel.nos.nome}`
      : `${rel.parte === 1 ? 'Intervalo · relatório' : 'Relatório'} da ${palavrasDaParte(rel.parte).rotulo} para ${rel.nos.nome}`));
}

function blocoCorrigir(rel) {
  return h('section', { class: 'folha-bloco' },
    h('h2', {}, `A corrigir ${palavrasDaParte(rel.parte).proxima}`),
    rel.corrigir.length
      ? h('ol', { class: 'pontos corrigir' }, rel.corrigir.map(ponto))
      : h('p', { class: 'vazio' }, semPontosACorrigir(rel)));
}

function blocoManter(rel) {
  if (!rel.manter.length) return null;
  return h('section', { class: 'folha-bloco' },
    h('h2', {}, 'A manter'),
    h('ul', { class: 'pontos manter' }, rel.manter.map(ponto)));
}

const ponto = (p) => h('li', {}, h('div', {}, h('strong', {}, p.titulo), h('span', {}, p.detalhe)));

function blocoNumeros(rel, equipas) {
  const nos = equipas.find((e) => e.equipaId === rel.nos.equipaId);
  const eles = equipas.find((e) => e.equipaId === rel.eles.equipaId);
  const celula = (n, quem) => h('td', { class: `num${n.vantagem === quem ? ' vantagem' : ''}` }, n[quem]);
  return h('section', { class: 'folha-bloco' },
    h('h2', {}, palavrasDaParte(rel.parte).numeros),
    h('table', { class: 'tabela numeros-intervalo' },
      h('thead', {}, h('tr', {},
        h('th', {}, ''),
        h('th', { class: 'num' }, pontoEquipa(nos), rel.nos.nome),
        h('th', { class: 'num' }, pontoEquipa(eles), rel.eles.nome))),
      h('tbody', {}, rel.numeros.map((n) => h('tr', {}, h('td', {}, n.rotulo), celula(n, 'nos'), celula(n, 'eles'))))));
}

function blocoJogadores(rel) {
  if (!rel.jogadores.length) return null;
  return h('section', { class: 'folha-bloco' },
    h('h2', {}, `Remates de ${rel.nos.nome}`),
    h('table', { class: 'tabela' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Jogador'), h('th', { class: 'num' }, 'Golos'), h('th', { class: 'num' }, 'Remates'), h('th', { class: 'num' }, 'Eficácia'))),
      h('tbody', {}, rel.jogadores.map((j) => h('tr', {},
        h('td', {}, `#${j.numero}${j.nome ? ` ${j.nome}` : ''}`),
        h('td', { class: 'num' }, j.golos),
        h('td', { class: 'num' }, j.remates),
        h('td', { class: 'num' }, `${Math.round(j.eficacia)}%`))))));
}

// ---------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------
/** As partes com remates registados (a 1.ª sempre; a 2.ª só depois de começar). */
function partesDoJogo(dados) {
  const partes = new Set([1]);
  for (const r of dados.remates ?? []) partes.add(r.parte);
  return [...partes].sort((a, b) => a - b);
}

function escolhas(dados) {
  const partes = partesDoJogo(dados);
  // As partes e, a seguir, o jogo todo: só aparecem quando há mais do que a 1.ª parte (ou se abriram o jogo todo)
  const opcoes = partes.length > 1 || estado.parte === JOGO_TODO ? [...partes, JOGO_TODO] : [];
  return h('div', { class: 'separador-abas sem-impressao' },
    dados.equipas.map((e) => h('button', {
      type: 'button', class: e.equipaId === estado.equipaId ? 'ativo' : '',
      onclick: () => { estado.equipaId = e.equipaId; desenhar(); },
    }, `Para: ${e.nome}`)),
    opcoes.map((p) => h('button', {
      type: 'button', class: p === estado.parte ? 'ativo' : '',
      onclick: () => { estado.parte = p; desenhar(); },
    }, palavrasDaParte(p).rotulo)));
}

function desenhar() {
  const dados = estado.dados;
  if (!dados || dados.equipas.length !== 2) return;

  // Equipa do relatório: a pedida, senão a da conta, senão a da casa
  const ids = dados.equipas.map((e) => e.equipaId);
  if (!ids.includes(estado.equipaId)) estado.equipaId = ids.includes(estado.equipaDaConta) ? estado.equipaDaConta : ids[0];
  if (estado.parte !== JOGO_TODO && !partesDoJogo(dados).includes(estado.parte)) estado.parte = 1;

  const rel = relatorioIntervalo(dados, estado.equipaId, estado.parte);
  estado.relatorio = rel;
  const casa = dados.equipas.find((e) => e.eCasa) ?? dados.equipas[0];
  const fora = dados.equipas.find((e) => e.equipaId !== casa.equipaId);

  document.title = `${palavrasDaParte(rel.parte).tituloCurto} ${rel.golos.nos}–${rel.golos.eles} · ${rel.nos.nome} vs ${rel.eles.nome}`;
  document.querySelector('.titulo-topo').textContent = palavrasDaParte(rel.parte).tituloTopo;
  substituir(raiz,
    escolhas(dados),
    h('article', { class: 'folha' },
      cabecalho(rel, casa, fora),
      rel.poucosDados && h('p', { class: 'aviso-inline' }, avisoPoucosDados(rel)),
      blocoCorrigir(rel),
      blocoManter(rel),
      blocoNumeros(rel, dados.equipas),
      blocoJogadores(rel)));
  botaoCopiar.disabled = false;
  botaoImprimir.disabled = false;
}

function receber(dados) {
  estado.dados = dados;
  desenhar();
}

async function copiar() {
  if (!estado.relatorio) return;
  const texto = textoRelatorio(estado.relatorio);
  if (await copiarTexto(texto)) avisar('Texto copiado. Cola-o no WhatsApp ou no email.');
  else window.prompt('Copia este texto para partilhar o relatório:', texto);
}

/** Link inválido, jogo que não existe ou que já não é visível para esta pessoa. */
function mostrarSemAcesso(conta) {
  document.title = 'Jogo indisponível · Scouting de Andebol';
  botaoCopiar.hidden = true;
  botaoImprimir.hidden = true;
  substituir(raiz,
    h('section', { class: 'sem-acesso' },
      h('h1', {}, 'Este jogo não está disponível'),
      h('p', {}, conta
        ? 'O jogo não existe ou não é teu. Se recebeste uma ligação, pede uma nova a quem a partilhou.'
        : 'O jogo foi escondido, já passaram mais de 24 horas ou a ligação está incompleta. Pede uma ligação nova a quem a partilhou. Se o jogo é teu, entra na tua conta.'),
      conta
        ? h('a', { class: 'botao-link primario', href: './' }, 'Ver os meus jogos')
        : h('a', { class: 'botao-link primario', href: `entrar.html?voltar=${encodeURIComponent(`intervalo.html${location.search}`)}` }, 'Entrar na minha conta')));
}

let conta = null;

function mostrarEstadoLigacao(estadoLigacao) {
  const el = document.getElementById('ligacao');
  el.className = `ligacao ${estadoLigacao === 'ligado' ? 'ok' : estadoLigacao}`;
  el.textContent = TEXTO_ESTADO[estadoLigacao];
  if (estadoLigacao === 'negado') mostrarSemAcesso(conta);
}

try {
  conta = await obterConta();
} catch { /* sem resposta da API: segue como convidado */ }

// Voltar ao dashboard do mesmo jogo (e à área certa se não houver conta)
const seta = document.getElementById('voltar');
seta.href = `dashboard.html?jogo=${jogoId}${codigo ? `&c=${encodeURIComponent(codigo)}` : ''}`;

// Quem tem conta abre o relatório já do lado da sua equipa (se a equipa não vier no endereço)
if (conta && !equipaPedida) {
  try {
    const minha = (await obter('/api/equipas')).find((e) => e.propria);
    estado.equipaDaConta = minha?.id ?? null;
  } catch { /* sem equipa: fica a da casa */ }
}

botaoCopiar.addEventListener('click', copiar);
botaoImprimir.addEventListener('click', () => window.print());

ligar(jogoId, codigo, receber, mostrarEstadoLigacao);
