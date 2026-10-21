// Eventos do jogo: a lista de tudo o que foi registado e a janela para corrigir um evento (ou apagá-lo).
// As contas do formulário estão em eventos-jogo.js (testado à parte); aqui só se desenha.
import { h, substituir, avisar } from './dom.js';
import {
  obter, enviar, RESULTADOS, ROTULO_RESULTADO, SITUACOES, ROTULO_SITUACAO, SISTEMAS_DEFENSIVOS, ROTULO_SISTEMA, ROTULO_ZONA_BALIZA, urlExcel,
} from './api.js';
import { exigirConta } from './conta.js';
import { criarCampo, novoSvgCampo } from './campo.js';
import { criarBaliza, novoSvgBaliza } from './baliza.js';
import { escudo } from './escudo.js';
import {
  RESULTADOS_COM_LOCAL_NA_BALIZA, corpoDoEvento, erros, filtrarEventos, guardaRedesAdversarios, jogadoresDaEquipa, mudarEquipa,
  mudarResultado, mudarSituacao, mudou, textoMinuto, valoresDoEvento,
} from './eventos-jogo.js';

const jogoId = Number(new URLSearchParams(location.search).get('jogo'));
if (!jogoId) location.replace('./');

await exigirConta();

const conteudo = document.getElementById('conteudo');
const janela = document.getElementById('janela-evento');
const TIPOS_SETE_SEIS = ['SETE_SEIS_INICIO', 'SETE_SEIS_FIM'];   // marcam o ataque 7×6: não se trocam por outro tipo

const estado = {
  jogo: null,
  tipos: [],
  eventos: [],
  filtro: { equipaId: null, grupo: 'todos', parte: null, jogadorId: null },
};

const equipas = () => [
  { id: estado.jogo.casaId, nome: estado.jogo.casaNome, lado: 'casa' },
  { id: estado.jogo.foraId, nome: estado.jogo.foraNome, lado: 'fora' },
];
const ladoDe = (equipaId) => (equipaId === estado.jogo.casaId ? 'casa' : 'fora');
const nomeDe = (equipaId) => (equipaId === estado.jogo.casaId ? estado.jogo.casaNome : estado.jogo.foraNome);
const tempoDe = (e) => `${e.parte}.ª ${textoMinuto(e.segundoJogo)}`;
const golosDe = (equipaId) => estado.eventos.filter((e) => e.resultado === 'GOLO' && e.equipaId === equipaId).length;

// ---------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------
function detalhes(e) {
  if (!e.eRemate) return '';
  return [
    ROTULO_SITUACAO[e.situacao] ?? e.situacao,
    e.sistemaDefensivo ? `contra ${ROTULO_SISTEMA[e.sistemaDefensivo] ?? e.sistemaDefensivo}` : null,
    e.guardaRedesNumero != null ? `GR #${e.guardaRedesNumero} ${e.guardaRedesNome}` : null,
    e.balizaZona ? ROTULO_ZONA_BALIZA[e.balizaZona] : null,
  ].filter(Boolean).join(' · ');
}

function descricaoCurta(e) {
  const quem = e.jogadorNumero != null ? ` de #${e.jogadorNumero} ${e.jogadorNome}` : '';
  return `${e.resultado ? ROTULO_RESULTADO[e.resultado].toLowerCase() : e.tipoNome.toLowerCase()}${quem}, ${tempoDe(e)}`;
}

async function apagarEvento(e) {
  if (!confirm(`Apagar este evento (${descricaoCurta(e)})? Não dá para desfazer.`)) return;
  try {
    await enviar('DELETE', `/api/jogos/${jogoId}/eventos/${e.id}`);
    await carregarEventos();
    avisar('Evento apagado.');
  } catch (erro) {
    avisar(`Não foi possível apagar: ${erro.message}`, { erro: true });
  }
}

function linhaEvento(e) {
  return h('tr', { 'data-evento-id': e.id },
    h('td', { class: 'tempo' }, tempoDe(e)),
    h('td', {}, h('span', { class: `ponto-equipa ${ladoDe(e.equipaId)}` }), nomeDe(e.equipaId)),
    h('td', {}, e.resultado
      ? h('span', { class: 'etiqueta', 'data-resultado': e.resultado }, ROTULO_RESULTADO[e.resultado])
      : h('span', { class: 'etiqueta neutra' }, e.tipoNome)),
    h('td', {}, e.jogadorNumero != null ? `#${e.jogadorNumero} ${e.jogadorNome}` : '–'),
    h('td', { class: 'detalhes' }, detalhes(e)),
    h('td', { class: 'acoes-evento' },
      h('button', { type: 'button', class: 'botao suave pequeno', 'data-acao': 'corrigir', title: 'Corrigir este evento', onclick: () => abrirEdicao(e) }, 'Corrigir'),
      h('button', { type: 'button', class: 'apagar', 'data-acao': 'apagar', title: 'Apagar este evento', 'aria-label': `Apagar ${descricaoCurta(e)}`, onclick: () => apagarEvento(e) }, '✕')));
}

function botaoFiltro(rotulo, ativo, aoClicar, extra = {}) {
  return h('button', { type: 'button', class: ativo ? 'ativo' : '', 'aria-pressed': ativo ? 'true' : 'false', onclick: aoClicar, ...extra }, rotulo);
}

function filtros() {
  const f = estado.filtro;
  const mudar = (parcial) => { Object.assign(f, parcial); desenhar(); };
  const comEventos = new Set(estado.eventos.map((e) => e.jogadorId).filter((id) => id != null));
  const seletorJogador = h('select', {
    'aria-label': 'Jogador', 'data-filtro': 'jogador',
    onchange: (ev) => mudar({ jogadorId: ev.target.value ? Number(ev.target.value) : null }),
  },
  h('option', { value: '' }, 'Todos os jogadores'),
  equipas().map((eq) => h('optgroup', { label: eq.nome },
    jogadoresDaEquipa(estado.jogo.jogadores, eq.id).filter((j) => comEventos.has(j.id))
      .map((j) => h('option', { value: j.id, selected: j.id === f.jogadorId }, `#${j.numero} ${j.nome}`)))));
  return h('div', { class: 'filtros-eventos' },
    h('div', { class: 'separador-abas', role: 'group', 'aria-label': 'Equipa' },
      botaoFiltro('As duas equipas', f.equipaId == null, () => mudar({ equipaId: null }), { 'data-filtro': 'equipa-todas' }),
      equipas().map((eq) => botaoFiltro(eq.nome, f.equipaId === eq.id, () => mudar({ equipaId: eq.id }), { 'data-filtro': `equipa-${eq.lado}` }))),
    h('div', { class: 'separador-abas', role: 'group', 'aria-label': 'Tipo de evento' },
      botaoFiltro('Tudo', f.grupo === 'todos', () => mudar({ grupo: 'todos' }), { 'data-filtro': 'grupo-todos' }),
      botaoFiltro('Remates', f.grupo === 'remates', () => mudar({ grupo: 'remates' }), { 'data-filtro': 'grupo-remates' }),
      botaoFiltro('Outros eventos', f.grupo === 'outros', () => mudar({ grupo: 'outros' }), { 'data-filtro': 'grupo-outros' }),
      botaoFiltro('As duas partes', f.parte == null, () => mudar({ parte: null }), { 'data-filtro': 'parte-todas' }),
      botaoFiltro('1.ª parte', f.parte === 1, () => mudar({ parte: 1 }), { 'data-filtro': 'parte-1' }),
      botaoFiltro('2.ª parte', f.parte === 2, () => mudar({ parte: 2 }), { 'data-filtro': 'parte-2' }),
      seletorJogador));
}

function cabecalho() {
  const j = estado.jogo;
  const data = new Date(j.dataHora).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' });
  return h('section', { class: 'cartao cabecalho-eventos' },
    h('div', { class: 'equipas' },
      h('span', { class: 'equipa-nome' }, escudo(j.casaId, j.casaEscudo), j.casaNome),
      h('span', { class: 'resultado', id: 'resultado-eventos' }, `${golosDe(j.casaId)} – ${golosDe(j.foraId)}`),
      h('span', { class: 'equipa-nome' }, escudo(j.foraId, j.foraEscudo), j.foraNome)),
    h('p', { class: 'meta' }, [data, j.local].filter(Boolean).join(' · '), j.terminadoEm ? h('span', { class: 'etiqueta terminado' }, 'Terminado') : null),
    h('div', { class: 'acoes-jogo' },
      h('a', { class: 'botao-link primario pequeno', href: `banco.html?jogo=${j.id}` }, 'Banco'),
      j.codigo ? h('a', { class: 'botao-link pequeno', href: `dashboard.html?jogo=${j.id}&c=${encodeURIComponent(j.codigo)}` }, 'Dashboard') : null,
      h('a', { class: 'botao-link suave pequeno', href: urlExcel(j.id), download: '' }, '⬇ Excel'),
      h('a', { class: 'botao-link suave pequeno', href: './' }, '← Jogos')));
}

function desenhar() {
  const visiveis = filtrarEventos(estado.eventos, estado.filtro).slice().reverse();   // os mais recentes primeiro
  substituir(conteudo,
    cabecalho(),
    estado.eventos.length === 0
      ? h('p', { class: 'vazio', id: 'sem-eventos' }, 'Este jogo ainda não tem eventos registados.')
      : [
        filtros(),
        h('p', { class: 'contagem-eventos', id: 'contagem-eventos' },
          visiveis.length === estado.eventos.length
            ? `${estado.eventos.length} ${estado.eventos.length === 1 ? 'evento' : 'eventos'}, os mais recentes primeiro.`
            : `${visiveis.length} de ${estado.eventos.length} eventos.`),
        visiveis.length === 0
          ? h('p', { class: 'vazio' }, 'Nenhum evento com estes filtros.')
          : h('div', { class: 'tabela-rolagem' },
            h('table', { class: 'tabela tabela-eventos', id: 'tabela-eventos' },
              h('thead', {}, h('tr', {},
                ['Tempo', 'Equipa', 'Evento', 'Jogador', 'Detalhes', ''].map((t) => h('th', { scope: 'col' }, t)))),
              h('tbody', {}, visiveis.map(linhaEvento)))),
      ]);
}

async function carregarEventos() {
  estado.eventos = await obter(`/api/jogos/${jogoId}/eventos`);
  // um filtro por um jogador que já não tem eventos deixaria a lista vazia sem saída
  if (estado.filtro.jogadorId != null && !estado.eventos.some((e) => e.jogadorId === estado.filtro.jogadorId)) estado.filtro.jogadorId = null;
  desenhar();
}

// ---------------------------------------------------------------------
// Janela para corrigir um evento
// ---------------------------------------------------------------------
let focoAntes = null;

function fecharJanela() {
  janela.hidden = true;
  janela.replaceChildren();
  document.removeEventListener('keydown', aoPremirTecla);
  focoAntes?.focus?.();
  focoAntes = null;
}

// Tocar fora da janela fecha-a
janela.addEventListener('click', (ev) => { if (ev.target === janela) fecharJanela(); });

function aoPremirTecla(ev) {
  if (ev.key === 'Escape') fecharJanela();
}

function preencher(seletor, opcoes, atual) {
  seletor.replaceChildren(...opcoes.map((o) => h('option', { value: o.valor }, o.rotulo)));
  seletor.value = atual == null ? '' : String(atual);
}

function marcar(botao, ativo) {
  botao.classList.toggle('ativo', ativo);
  botao.setAttribute('aria-pressed', ativo ? 'true' : 'false');
}

function abrirEdicao(evento) {
  const inicial = valoresDoEvento(evento);
  let v = { ...inicial };
  focoAntes = document.activeElement;

  const rotuloCampo = (texto, ...controlos) => h('label', {}, texto, ...controlos);

  // Quem e quando
  const botoesEquipa = equipas().map((eq) => h('button', {
    type: 'button', 'data-campo': 'equipa', 'data-equipa-id': eq.id,
    onclick: () => { v = mudarEquipa(v, eq.id); refrescar(); },
  }, eq.nome));
  const seletorJogador = h('select', {
    'data-campo': 'jogador',
    onchange: (ev) => { v.jogadorId = ev.target.value ? Number(ev.target.value) : null; refrescar(); },
  });
  const tiposTrocaveis = estado.tipos.filter((t) => !t.eRemate && !TIPOS_SETE_SEIS.includes(t.codigo));
  const seletorTipo = !evento.eRemate && !TIPOS_SETE_SEIS.includes(evento.tipoEvento)
    ? h('select', { 'data-campo': 'tipo', onchange: (ev) => { v.tipo = ev.target.value; refrescar(); } },
      tiposTrocaveis.map((t) => h('option', { value: t.codigo, selected: t.codigo === v.tipo }, t.nome)))
    : null;
  const botoesParte = [1, 2].map((p) => h('button', {
    type: 'button', 'data-campo': 'parte', 'data-parte': p, onclick: () => { v.parte = p; refrescar(); },
  }, `${p}.ª parte`));
  const campoMinuto = h('input', {
    type: 'text', 'data-campo': 'minuto', value: v.minuto, inputmode: 'numeric', autocomplete: 'off', placeholder: 'mm:ss', maxlength: 7,
    oninput: (ev) => { v.minuto = ev.target.value; refrescarEstado(); },
  });

  // O remate
  const botoesResultado = RESULTADOS.map((r) => h('button', {
    type: 'button', class: 'filtro', 'data-campo': 'resultado', 'data-resultado': r, onclick: () => { v = mudarResultado(v, r); refrescar(); },
  }, ROTULO_RESULTADO[r]));
  const seletorSituacao = h('select', {
    'data-campo': 'situacao', onchange: (ev) => { v = mudarSituacao(v, ev.target.value); refrescar(); },
  }, SITUACOES.map((s) => h('option', { value: s.codigo }, s.rotulo)));
  const seletorSistema = h('select', {
    'data-campo': 'sistema', onchange: (ev) => { v.sistemaDefensivo = ev.target.value || null; refrescar(); },
  });
  const seletorGuardaRedes = h('select', {
    'data-campo': 'guarda-redes', onchange: (ev) => { v.guardaRedesId = ev.target.value ? Number(ev.target.value) : null; refrescar(); },
  });
  const blocoSistema = rotuloCampo('Defesa do adversário', seletorSistema);

  // Os mapas
  const svgCampo = novoSvgCampo();
  const campo = criarCampo(svgCampo, { aoClicar: ({ x, y }) => { v.x = x; v.y = y; refrescar(); } });
  const svgBaliza = novoSvgBaliza();
  const baliza = criarBaliza(svgBaliza, { aoClicar: ({ x, y }) => { v.balizaX = x; v.balizaY = y; refrescar(); } });
  const semLocal = h('button', {
    type: 'button', class: 'botao suave pequeno', 'data-campo': 'sem-local',
    onclick: () => { v.balizaX = null; v.balizaY = null; refrescar(); },
  }, 'Sem local na baliza');
  const notaCampo = h('p', { class: 'janela-nota' }, 'Toca no mapa para mudar de onde foi o remate.');
  const notaBaliza = h('p', { class: 'janela-nota', 'data-campo': 'nota-baliza' });
  const blocoBaliza = h('div', { class: 'evento-baliza' }, svgBaliza, notaBaliza, h('div', { class: 'centro' }, semLocal));
  const blocoMapas = h('div', { class: 'evento-mapas' }, svgCampo, notaCampo, blocoBaliza);

  const textoErro = h('p', { class: 'erro-formulario', role: 'alert', 'data-campo': 'erros' });
  const guardar = h('button', { type: 'button', class: 'botao primario', 'data-campo': 'guardar' }, 'Guardar correção');
  const cancelar = h('button', { type: 'button', class: 'botao perigo', 'data-campo': 'cancelar', onclick: fecharJanela }, 'Cancelar');

  const campos = h('div', { class: 'evento-campos' },
    rotuloCampo('Equipa', h('div', { class: 'separador-abas' }, botoesEquipa)),
    seletorTipo && rotuloCampo('Tipo de evento', seletorTipo),
    rotuloCampo('Jogador', seletorJogador),
    evento.eRemate && h('div', { class: 'rotulo' }, 'Resultado', h('div', { class: 'separador-abas' }, botoesResultado)),
    evento.eRemate && rotuloCampo('Situação', seletorSituacao),
    evento.eRemate && blocoSistema,
    evento.eRemate && rotuloCampo('Guarda-redes adversário', seletorGuardaRedes),
    h('div', { class: 'rotulo' }, 'Parte', h('div', { class: 'separador-abas' }, botoesParte)),
    rotuloCampo('Minuto do jogo (mm:ss)', campoMinuto));

  function refrescarEstado() {
    const problemas = erros(v);
    textoErro.textContent = problemas.join(' ');
    guardar.disabled = problemas.length > 0 || !mudou(inicial, v);
  }

  function refrescar() {
    const jogo = estado.jogo;
    botoesEquipa.forEach((b) => marcar(b, Number(b.dataset.equipaId) === v.equipaId));
    botoesParte.forEach((b) => marcar(b, Number(b.dataset.parte) === v.parte));
    const obrigatorio = evento.eRemate || v.tipo === 'VERMELHO';
    const jogadores = jogadoresDaEquipa(jogo.jogadores, v.equipaId);
    preencher(seletorJogador, [
      { valor: '', rotulo: obrigatorio ? 'Escolhe o jogador' : 'Sem jogador (evento da equipa)' },
      ...jogadores.map((j) => ({ valor: j.id, rotulo: `#${j.numero} ${j.nome}` })),
    ], v.jogadorId);
    if (evento.eRemate) {
      botoesResultado.forEach((b) => marcar(b, b.dataset.resultado === v.resultado));
      seletorSituacao.value = v.situacao;
      preencher(seletorSistema, [{ valor: '', rotulo: 'Não indicada' }, ...SISTEMAS_DEFENSIVOS.map((s) => ({ valor: s.codigo, rotulo: s.rotulo }))], v.sistemaDefensivo);
      blocoSistema.hidden = v.situacao !== 'POSICIONAL';
      preencher(seletorGuardaRedes, [
        { valor: '', rotulo: 'Sem guarda-redes' },
        ...guardaRedesAdversarios(jogo.jogadores, v.equipaId, jogo).map((j) => ({ valor: j.id, rotulo: `#${j.numero} ${j.nome}` })),
      ], v.guardaRedesId);
      const jogador = jogadores.find((j) => j.id === v.jogadorId);
      campo.marcadores(v.x != null && v.y != null ? [{ x: v.x, y: v.y, resultado: v.resultado ?? 'GOLO', jogadorNumero: jogador?.numero ?? '?' }] : []);
      const comLocal = RESULTADOS_COM_LOCAL_NA_BALIZA.includes(v.resultado);
      blocoBaliza.hidden = !comLocal;
      if (comLocal) {
        baliza.marcadores(v.balizaX != null && v.balizaY != null ? [{ balizaX: v.balizaX, balizaY: v.balizaY, jogadorNumero: jogador?.numero ?? '?' }] : [], v.resultado);
        notaBaliza.textContent = v.resultado === 'GOLO'
          ? 'Onde entrou o golo (a baliza vista de frente, do lado de quem remata). Toca para mudar.'
          : 'Onde defendeu o guarda-redes (a baliza vista de frente, do lado de quem remata). Toca para mudar.';
        semLocal.disabled = v.balizaX == null;
      }
    }
    refrescarEstado();
  }

  guardar.addEventListener('click', async () => {
    guardar.disabled = true;
    try {
      await enviar('PUT', `/api/jogos/${jogoId}/eventos/${evento.id}`, corpoDoEvento(v));
      fecharJanela();
      await carregarEventos();
      avisar('Evento corrigido.');
    } catch (erro) {
      textoErro.textContent = erro.message;
      guardar.disabled = false;
    }
  });

  substituir(janela,
    h('div', { class: 'janela janela-evento cartao', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'titulo-janela-evento' },
      h('h2', { id: 'titulo-janela-evento' }, evento.eRemate ? 'Corrigir remate' : `Corrigir ${evento.tipoNome.toLowerCase()}`),
      h('p', { class: 'janela-sub' }, `Registado em ${tempoDe(evento)}, ${nomeDe(evento.equipaId)}`),
      h('div', { class: 'evento-corpo' }, campos, evento.eRemate ? blocoMapas : null),
      textoErro,
      h('div', { class: 'janela-acoes' }, cancelar, guardar)));
  janela.hidden = false;
  document.addEventListener('keydown', aoPremirTecla);
  refrescar();
  seletorJogador.focus();
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
try {
  [estado.jogo, estado.tipos, estado.eventos] = await Promise.all([
    obter(`/api/jogos/${jogoId}`),
    obter('/api/tipos-evento'),
    obter(`/api/jogos/${jogoId}/eventos`),
  ]);
  document.title = `Eventos · ${estado.jogo.casaNome} vs ${estado.jogo.foraNome} · Scouting de Andebol`;
  desenhar();
} catch (erro) {
  substituir(conteudo,
    h('p', { class: 'vazio', id: 'erro-eventos' }, erro.status === 404 ? 'Jogo não encontrado.' : `Não foi possível carregar os eventos: ${erro.message}`),
    h('a', { class: 'botao-link primario', href: './' }, 'Voltar aos jogos'));
}
