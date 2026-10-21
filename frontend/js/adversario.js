// Relatório do próximo adversário: o que explorar e o que travar, os números por jogo, os jogadores perigosos, os 7 metros,
// as defesas e as zonas, para o treinador ler no tablet, imprimir ou copiar como texto. As contas estão em
// relatorio-adversario.js (testado à parte); aqui só se desenha.
import { h, substituir, avisar, copiarTexto } from './dom.js';
import { obter, ROTULO_SISTEMA, ROTULO_ZONA_BALIZA, ROTULO_CORREDOR, ROTULO_POSICAO, ORDEM_CORREDOR } from './api.js';
import { exigirConta } from './conta.js';
import { escudo } from './escudo.js';
import { relatorioAdversario, textoRelatorio, avisoPoucosDados, semPontos, descricaoDosJogos } from './relatorio-adversario.js';

await exigirConta();

const parametros = new URLSearchParams(location.search);

const estado = {
  equipas: [],                                  // as equipas da conta; a da conta tem propria = true
  equipaId: Number(parametros.get('equipa')) || null,
  contraNos: parametros.get('contra') === 'nos', // só os jogos contra a equipa da conta
  dados: null,                                  // o que a API devolveu para a equipa escolhida
  relatorio: null,
  aCarregar: false,
};

const raiz = document.getElementById('adversario');
const DATA = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });

const nossa = () => estado.equipas.find((e) => e.propria) ?? null;
const equipaAtual = () => estado.equipas.find((e) => e.id === estado.equipaId) ?? null;
const rotuloJogador = (j) => `#${j.numero}${j.nome ? ` ${j.nome}` : ''}`;
const percentagem = (valor) => (valor == null ? '–' : `${Math.round(valor)}%`);

// ---------------------------------------------------------------------
// Blocos da folha
// ---------------------------------------------------------------------
function cabecalho(rel) {
  const equipa = equipaAtual();
  return h('header', { class: 'folha-cabeca' },
    h('div', { class: 'folha-placar' },
      h('span', { class: 'folha-escudo' }, escudo(equipa.id, equipa.escudo, 'placar')),
      h('h2', { class: 'folha-titulo-equipa', id: 'adversario-nome' }, rel.equipa.nome)),
    h('p', { class: 'folha-sub', id: 'adversario-base' }, descricaoDosJogos(rel, nossa()?.nome ?? null)));
}

const ponto = (p) => h('li', { 'data-ponto': p.codigo }, h('div', {}, h('strong', {}, p.titulo), h('span', {}, p.detalhe)));

function blocoPontos(rel, tipo, titulo, classe) {
  const lista = rel[tipo];
  return h('section', { class: 'folha-bloco', id: `bloco-${tipo}` },
    h('h2', {}, titulo),
    lista.length
      ? h('ol', { class: `pontos ${classe}` }, lista.map(ponto))
      : h('p', { class: 'vazio' }, semPontos(rel, tipo)));
}

function blocoNumeros(rel) {
  if (!rel.numeros.length) return null;
  return h('section', { class: 'folha-bloco', id: 'bloco-numeros' },
    h('h2', {}, 'Em números'),
    h('table', { class: 'tabela' },
      h('tbody', {}, rel.numeros.map((n) => h('tr', {}, h('td', {}, n.rotulo), h('td', { class: 'num' }, n.valor))))));
}

function blocoJogadores(rel) {
  if (!rel.jogadores.length) return null;
  return h('section', { class: 'folha-bloco', id: 'bloco-jogadores' },
    h('h2', {}, 'Quem marca'),
    h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Jogador'), h('th', {}, 'Posição'), h('th', { class: 'num' }, 'Golos'), h('th', { class: 'num' }, 'Remates'),
        h('th', { class: 'num' }, 'Eficácia'), h('th', { class: 'num' }, '7 m'))),
      h('tbody', {}, rel.jogadores.map((j) => h('tr', {},
        h('td', {}, rotuloJogador(j)),
        h('td', {}, ROTULO_POSICAO[j.posicao] ?? ''),
        h('td', { class: 'num' }, j.golos),
        h('td', { class: 'num' }, j.remates),
        h('td', { class: 'num' }, percentagem(j.eficacia)),
        h('td', { class: 'num' }, j.seteMetros || '–')))))));
}

function blocoSeteMetros(rel) {
  const { lancadores, total, sofridos } = rel.seteMetros;
  if (!total.lancamentos && !sofridos.lancamentos) return null;
  const tendencia = (l) => (l.tendencia ? `${ROTULO_ZONA_BALIZA[l.tendencia.zona]} (${l.tendencia.total} de ${l.tendencia.de})` : '–');
  return h('section', { class: 'folha-bloco', id: 'bloco-sete-metros' },
    h('h2', {}, '7 metros'),
    lancadores.length > 0 && h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Lançador'), h('th', { class: 'num' }, 'Golos'), h('th', { class: 'num' }, 'Lançamentos'),
        h('th', { class: 'num' }, 'Defendidos'), h('th', {}, 'Onde bate'))),
      h('tbody', {}, lancadores.map((l) => h('tr', {},
        h('td', {}, rotuloJogador(l)),
        h('td', { class: 'num' }, l.golos),
        h('td', { class: 'num' }, l.lancamentos),
        h('td', { class: 'num' }, l.defendidos),
        h('td', {}, tendencia(l))))))),
    h('p', { class: 'meta-equipa' },
      `Lançaram ${total.lancamentos} e marcaram ${total.golos}. Sofreram ${sofridos.lancamentos} e defenderam ${sofridos.defendidos}.`));
}

function tabelaDefesas(linhas, { comParte }) {
  return h('table', { class: 'tabela' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'Defesa'), h('th', { class: 'num' }, 'Remates'), h('th', { class: 'num' }, 'Golos'), h('th', { class: 'num' }, 'Eficácia'),
      comParte && h('th', { class: 'num' }, 'Quanto a usam'))),
    h('tbody', {}, linhas.map((l) => h('tr', {},
      h('td', {}, ROTULO_SISTEMA[l.sistema]),
      h('td', { class: 'num' }, l.remates),
      h('td', { class: 'num' }, l.golos),
      h('td', { class: 'num' }, percentagem(l.eficacia)),
      comParte && h('td', { class: 'num' }, percentagem(100 * l.parte))))));
}

function blocoDefesas(rel) {
  if (!rel.ataqueContraDefesas.length && !rel.defesasQueJoga.length) return null;
  return h('section', { class: 'folha-bloco', id: 'bloco-defesas' },
    h('h2', {}, 'Defesas'),
    rel.ataqueContraDefesas.length > 0 && [
      h('h3', {}, 'O ataque deles contra cada defesa'),
      h('div', { class: 'tabela-rolagem' }, tabelaDefesas(rel.ataqueContraDefesas, { comParte: false })),
    ],
    rel.defesasQueJoga.length > 0 && [
      h('h3', {}, 'A defesa que jogam (remates que sofrem)'),
      h('div', { class: 'tabela-rolagem' }, tabelaDefesas(rel.defesasQueJoga, { comParte: true })),
    ]);
}

function blocoGuardaRedes(rel) {
  if (!rel.guardaRedes.length) return null;
  return h('section', { class: 'folha-bloco', id: 'bloco-guarda-redes' },
    h('h2', {}, 'Guarda-redes'),
    h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Guarda-redes'), h('th', { class: 'num' }, 'Remates à baliza'), h('th', { class: 'num' }, 'Defesas'), h('th', { class: 'num' }, '% de defesa'))),
      h('tbody', {}, rel.guardaRedes.map((g) => h('tr', {},
        h('td', {}, rotuloJogador(g)),
        h('td', { class: 'num' }, g.baliza),
        h('td', { class: 'num' }, g.defesas),
        h('td', { class: 'num' }, percentagem(g.percentagem))))))));
}

function blocoZonas(rel) {
  const { dela, sofridos } = rel.corredores;
  if (!dela.length && !sofridos.length && !rel.zonaDaBaliza) return null;
  const golos = (lista, corredor) => lista.find((c) => c.corredor === corredor)?.golos ?? 0;
  return h('section', { class: 'folha-bloco', id: 'bloco-zonas' },
    h('h2', {}, 'Zonas'),
    (dela.length > 0 || sofridos.length > 0) && h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Golos por onde'), h('th', { class: 'num' }, 'Marcam'), h('th', { class: 'num' }, 'Sofrem'))),
      h('tbody', {}, ORDEM_CORREDOR.map((c) => h('tr', {},
        h('td', {}, ROTULO_CORREDOR[c]), h('td', { class: 'num' }, golos(dela, c)), h('td', { class: 'num' }, golos(sofridos, c))))))),
    rel.zonaDaBaliza && h('p', { class: 'meta-equipa' },
      `Na baliza rematam sobretudo ${ROTULO_ZONA_BALIZA[rel.zonaDaBaliza.zona]} (${rel.zonaDaBaliza.total} de ${rel.zonaDaBaliza.de} remates com local).`));
}

function blocoJogos(rel) {
  if (!rel.jogos.length) return null;
  const mais = [...rel.jogos].reverse();
  return h('section', { class: 'folha-bloco', id: 'bloco-jogos' },
    h('h2', {}, 'Jogos usados'),
    h('ul', { class: 'jogos-usados' }, mais.map((j) => h('li', {},
      h('span', { class: `resultado-jogo res-${j.resultado}` }, j.resultado),
      h('span', {}, `${DATA.format(new Date(j.dataHora))} · ${j.emCasa ? 'em casa' : 'fora'} contra ${j.adversarioNome}`),
      h('strong', {}, `${j.golos}–${j.golosAdversario}`)))));
}

// ---------------------------------------------------------------------
// Escolhas
// ---------------------------------------------------------------------
function escolhas() {
  const seletor = h('select', {
    id: 'escolher-equipa', 'aria-label': 'Equipa do relatório',
    onchange: (evento) => escolherEquipa(Number(evento.target.value)),
  }, estado.equipas.map((e) => h('option', { value: e.id, selected: e.id === estado.equipaId }, e.propria ? `${e.nome} (a minha equipa)` : e.nome)));
  seletor.value = String(estado.equipaId);
  const podeFiltrar = nossa() && estado.equipaId !== nossa().id;

  return h('div', { class: 'filtros-estatisticas sem-impressao', id: 'escolhas-adversario' },
    h('div', { class: 'grupo-filtro' }, h('span', { class: 'grupo-filtro-rotulo' }, 'Equipa'), seletor),
    podeFiltrar && h('div', { class: 'grupo-filtro', role: 'group', 'aria-label': 'Jogos usados' },
      h('span', { class: 'grupo-filtro-rotulo' }, 'Jogos'),
      h('div', { class: 'separador-abas' },
        h('button', { type: 'button', class: !estado.contraNos ? 'ativo' : '', 'aria-pressed': String(!estado.contraNos), 'data-filtro': 'jogos-todos', onclick: () => escolherJogos(false) }, 'Todos'),
        h('button', { type: 'button', class: estado.contraNos ? 'ativo' : '', 'aria-pressed': String(estado.contraNos), 'data-filtro': 'jogos-nos', onclick: () => escolherJogos(true) }, `Só contra ${nossa().nome}`))),
    h('div', { class: 'acoes-relatorio' },
      h('button', { type: 'button', class: 'botao suave pequeno', id: 'copiar', disabled: !estado.relatorio, onclick: copiar, title: 'Copiar o relatório como texto, para colar no WhatsApp ou no email' }, 'Copiar texto'),
      h('button', { type: 'button', class: 'botao suave pequeno', id: 'imprimir', disabled: !estado.relatorio, onclick: () => window.print(), title: 'Imprimir o relatório (ou guardar em PDF)' }, 'Imprimir')));
}

function vazio(texto, link) {
  return h('div', { class: 'cartao vazio-cartao' }, h('p', { class: 'vazio' }, texto), link && h('a', { class: 'botao-link primario', href: link.href }, link.texto));
}

// ---------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------
function desenhar() {
  if (!estado.equipas.length) {
    substituir(raiz, vazio('Ainda não tens equipas. Cria a tua equipa e um jogo para começares a registar.', { href: 'equipas.html', texto: 'Criar a minha equipa' }));
    return;
  }
  if (estado.relatorio === null) {
    substituir(raiz, escolhas(), h('p', { class: 'vazio' }, estado.aCarregar ? 'A carregar…' : 'Escolhe uma equipa.'));
    return;
  }
  const rel = estado.relatorio;
  document.title = `Adversário: ${rel.equipa.nome} · Scouting de Andebol`;
  substituir(raiz,
    escolhas(),
    h('article', { class: `folha${estado.aCarregar ? ' a-carregar' : ''}`, id: 'folha-adversario' },
      cabecalho(rel),
      rel.poucosDados && rel.nJogos > 0 && h('p', { class: 'aviso-inline' }, avisoPoucosDados(rel)),
      !rel.nJogos && h('p', { class: 'vazio' }, estado.contraNos
        ? `Ainda não há jogos registados entre ${rel.equipa.nome} e ${nossa()?.nome ?? 'a tua equipa'}.`
        : 'Ainda não há jogos registados desta equipa. O relatório aparece quando o primeiro jogo tiver eventos.'),
      rel.nJogos > 0 && [
        blocoPontos(rel, 'explorar', 'A explorar', 'explorar'),
        blocoPontos(rel, 'travar', 'A travar', 'travar'),
        blocoNumeros(rel),
        blocoJogadores(rel),
        blocoSeteMetros(rel),
        blocoDefesas(rel),
        blocoGuardaRedes(rel),
        blocoZonas(rel),
        blocoJogos(rel),
      ]));
}

function calcular() {
  estado.relatorio = estado.dados
    ? relatorioAdversario(estado.dados, { contraEquipaId: estado.contraNos && nossa() ? nossa().id : null })
    : null;
}

async function carregar() {
  estado.aCarregar = true;
  desenhar();
  try {
    estado.dados = await obter(`/api/equipas/${estado.equipaId}/adversario`);
    calcular();
  } catch (erro) {
    estado.dados = null;
    estado.relatorio = null;
    avisar(`Não foi possível carregar o relatório: ${erro.message}`, { erro: true });
  } finally {
    estado.aCarregar = false;
    desenhar();
  }
}

function guardarNoEndereco() {
  const p = new URLSearchParams();
  if (estado.equipaId) p.set('equipa', estado.equipaId);
  if (estado.contraNos) p.set('contra', 'nos');
  try { history.replaceState(null, '', `?${p}`); } catch { /* sem history */ }
}

async function escolherEquipa(id) {
  estado.equipaId = id;
  if (nossa() && id === nossa().id) estado.contraNos = false;
  guardarNoEndereco();
  await carregar();
}

function escolherJogos(contraNos) {
  estado.contraNos = contraNos;
  guardarNoEndereco();
  calcular();
  desenhar();
}

async function copiar() {
  if (!estado.relatorio) return;
  const texto = textoRelatorio(estado.relatorio, nossa()?.nome ?? null);
  if (await copiarTexto(texto)) avisar('Texto copiado. Cola-o no WhatsApp ou no email.');
  else window.prompt('Copia este texto para partilhar o relatório:', texto);
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
try {
  estado.equipas = await obter('/api/equipas');
  // Sem equipa no endereço (ou de outra conta): a primeira adversária, senão a da conta
  if (!estado.equipas.some((e) => e.id === estado.equipaId)) {
    estado.equipaId = (estado.equipas.find((e) => !e.propria) ?? estado.equipas[0])?.id ?? null;
  }
  if (estado.equipaId == null) {
    desenhar();
  } else {
    if (nossa() && estado.equipaId === nossa().id) estado.contraNos = false;
    await carregar();
  }
} catch (erro) {
  substituir(raiz, h('p', { class: 'vazio' }, `Não foi possível carregar as equipas: ${erro.message}`));
}
