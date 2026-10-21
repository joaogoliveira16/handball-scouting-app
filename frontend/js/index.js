// Lista de jogos, criação de um jogo novo e link de partilha do dashboard.
import { h, substituir, avisar, copiarTexto } from './dom.js';
import { obter, enviar, urlExcel, urlPartilha } from './api.js';
import { exigirConta } from './conta.js';
import { escudo } from './escudo.js';
import { criarFila, criarEnvio } from './fila.js';
import { registarOffline, jogosGuardados } from './offline.js';

registarOffline();
// Sem rede a conta não responde: não deixa a lista presa à espera
await Promise.race([exigirConta(), new Promise((resolve) => setTimeout(resolve, 6000))]);

const contentor = document.getElementById('jogos');
const tituloJogos = document.getElementById('titulo-jogos');
const novoJogo = document.getElementById('novo-jogo');
const formulario = document.getElementById('form-jogo');
const ladoJogo = document.getElementById('lado');
const campoAdversario = document.getElementById('adversario');
const listaAdversarios = document.getElementById('adversarios');
const textoEquipa = document.getElementById('equipa-jogo');
const erroJogo = document.getElementById('erro-jogo');
const botaoCriar = document.getElementById('criar-jogo');
const avisoFila = document.getElementById('fila-pendente');

// Eventos do banco que ficaram por enviar (a rede caiu e o banco foi fechado antes de voltar): seguem daqui
const fila = criarFila();
const envio = criarEnvio({
  fila,
  enviar: (item) => enviar('POST', `/api/jogos/${item.jogoId}/eventos`, item.corpo),
  aoRejeitar: (item, erro) => avisar(`Um evento não foi aceite pelo servidor e foi descartado: ${erro.message}`, { erro: true, duracao: 8000 }),
  aoTerminar: (resultado) => {
    desenharFila();
    if (resultado?.enviados) carregarJogos(equipasDaConta);   // os marcadores mudaram
  },
});

function desenharFila() {
  const n = fila.contar();
  avisoFila.hidden = n === 0;
  avisoFila.textContent = n === 1
    ? '⏳ 1 evento do banco por enviar. Segue sozinho quando houver rede.'
    : `⏳ ${n} eventos do banco por enviar. Seguem sozinhos quando houver rede.`;
}

async function partilhar(jogo) {
  const link = urlPartilha(jogo.id, jogo.codigo);
  if (await copiarTexto(link)) {
    avisar('Ligação copiada. Quem a abrir vê o jogo em direto, sem conta.');
  } else {
    window.prompt('Copia esta ligação para partilhar o jogo em direto:', link);
  }
}

/** O dono mostra ou esconde o jogo na lista de jogos da área de convidado. */
async function mudarVisibilidade(jogo, caixa) {
  const visivel = caixa.checked;
  caixa.disabled = true;
  try {
    await enviar('PUT', `/api/jogos/${jogo.id}/visibilidade`, { visivel });
    jogo.visivelConvidados = visivel;
    avisar(visivel
      ? 'Este jogo aparece na área de convidado durante 24 horas.'
      : 'Jogo escondido: só quem tem a ligação o vê.');
  } catch (erro) {
    caixa.checked = !visivel;
    avisar(`Não foi possível mudar: ${erro.message}`, { erro: true });
  } finally {
    caixa.disabled = false;
  }
}

let jogosAtuais = [];
const aEditar = new Set();   // jogos com o formulário de correção aberto

const comoValorLocal = (iso) => {   // para o campo «data e hora» (hora local do tablet)
  const d = new Date(iso);
  const dois = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}`;
};

/** O dono marca o fim do jogo (o banco fecha o registo) ou volta a abri-lo. */
async function terminarJogo(jogo, terminado) {
  const nome = `${jogo.casaNome} vs ${jogo.foraNome}`;
  if (terminado && !confirm(`Terminar o jogo ${nome}? O banco deixa de registar eventos (podes reabri-lo).`)) return;
  try {
    await enviar('PUT', `/api/jogos/${jogo.id}/terminado`, { terminado });
    jogo.terminadoEm = terminado ? new Date().toISOString() : null;
    desenharJogos();
    avisar(terminado ? 'Jogo terminado.' : 'Jogo reaberto.');
  } catch (erro) {
    avisar(`Não foi possível mudar: ${erro.message}`, { erro: true });
  }
}

async function apagarJogo(jogo) {
  if (!confirm(`Apagar o jogo ${jogo.casaNome} vs ${jogo.foraNome} e todos os seus eventos? Não dá para desfazer.`)) return;
  try {
    await enviar('DELETE', `/api/jogos/${jogo.id}`);
    jogosAtuais = jogosAtuais.filter((j) => j.id !== jogo.id);
    aEditar.delete(jogo.id);
    desenharJogos();
    avisar('Jogo apagado.');
  } catch (erro) {
    avisar(`Não foi possível apagar: ${erro.message}`, { erro: true });
  }
}

/** Formulário de correção de um jogo: adversário e lado (só sem eventos, o lado sempre), data e hora e local. */
function formularioEdicao(jogo) {
  const minha = equipasDaConta.find((e) => e.propria);
  const nossa = Boolean(minha) && [jogo.casaId, jogo.foraId].includes(minha.id);
  const emCasa = nossa && jogo.casaId === minha.id;
  const adversarioAtual = nossa ? (emCasa ? jogo.foraNome : jogo.casaNome) : null;

  const campoAdv = h('input', { maxlength: 80, value: adversarioAtual ?? '', autocomplete: 'off', required: true, list: 'adversarios', 'data-campo': 'adversario' });
  const campoLado = h('select', { 'data-campo': 'lado' },
    h('option', { value: 'casa', selected: emCasa }, 'Em casa'),
    h('option', { value: 'fora', selected: !emCasa }, 'Fora'));
  const campoData = h('input', { type: 'datetime-local', value: comoValorLocal(jogo.dataHora), 'data-campo': 'data' });
  const campoLocal = h('input', { maxlength: 120, value: jogo.local ?? '', placeholder: 'Pavilhão, cidade…', 'data-campo': 'local' });
  const erro = h('p', { class: 'erro-formulario largo', role: 'alert' });
  const guardar = h('button', { class: 'botao primario pequeno', type: 'submit' }, 'Guardar');

  return h('form', {
    class: 'formulario editar-jogo', novalidate: true, 'data-jogo': jogo.id,
    onsubmit: async (evento) => {
      evento.preventDefault();
      erro.textContent = '';
      const data = campoData.value ? new Date(campoData.value) : null;
      if (data && Number.isNaN(data.getTime())) { erro.textContent = 'Data e hora inválidas.'; return; }
      let casaId = jogo.casaId;
      let foraId = jogo.foraId;
      guardar.disabled = true;
      try {
        if (nossa) {
          const nome = campoAdv.value.trim();
          if (!nome) { erro.textContent = 'Escreve o nome do adversário.'; return; }
          if (mesmoNome(nome, minha.nome)) { erro.textContent = 'O adversário tem de ser outra equipa.'; return; }
          const adversarioId = nome === adversarioAtual ? (emCasa ? jogo.foraId : jogo.casaId) : await equipaAdversaria(nome, equipasDaConta);
          [casaId, foraId] = campoLado.value === 'casa' ? [minha.id, adversarioId] : [adversarioId, minha.id];
        }
        await enviar('PUT', `/api/jogos/${jogo.id}`, { casaId, foraId, local: campoLocal.value.trim() || null, dataHora: data ? data.toISOString() : null });
        aEditar.delete(jogo.id);
        equipasDaConta = await carregarEquipas();
        prepararFormulario(equipasDaConta);
        await carregarJogos(equipasDaConta);
        avisar('Jogo atualizado.');
      } catch (falha) {
        erro.textContent = falha.message;
      } finally {
        guardar.disabled = false;
      }
    },
  },
    nossa && h('label', {}, 'Adversário', campoAdv),
    nossa && h('label', {}, 'A tua equipa joga', campoLado),
    h('label', {}, 'Data e hora', campoData),
    h('label', {}, 'Local', campoLocal),
    erro,
    h('div', { class: 'largo acoes-formulario' }, guardar,
      h('button', { class: 'botao suave pequeno', type: 'button', onclick: () => { aEditar.delete(jogo.id); desenharJogos(); } }, 'Cancelar')));
}

function linhaJogo(jogo) {
  const caixaVisivel = h('input', { type: 'checkbox', checked: jogo.visivelConvidados !== false });
  caixaVisivel.addEventListener('change', () => mudarVisibilidade(jogo, caixaVisivel));
  const data = new Date(jogo.dataHora).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' });
  return h('li', { class: 'jogo-linha' },
    h('div', { class: 'info' },
      h('div', { class: 'equipas' },
        h('span', { class: 'equipa-nome' }, escudo(jogo.casaId, jogo.casaEscudo), jogo.casaNome),
        h('span', { class: 'contra' }, 'vs'),
        h('span', { class: 'equipa-nome' }, escudo(jogo.foraId, jogo.foraEscudo), jogo.foraNome)),
      h('div', { class: 'meta' }, [data, jogo.local].filter(Boolean).join(' · '),
        jogo.terminadoEm ? h('span', { class: 'etiqueta terminado' }, 'Terminado') : null)),
    h('div', { class: 'resultado', 'aria-label': `Resultado ${jogo.golosCasa} a ${jogo.golosFora}` }, `${jogo.golosCasa} – ${jogo.golosFora}`),
    h('div', { class: 'acoes-jogo' },
      h('a', { class: 'botao-link primario pequeno', href: `banco.html?jogo=${jogo.id}` }, 'Banco'),
      h('a', { class: 'botao-link pequeno', href: `dashboard.html?jogo=${jogo.id}&c=${encodeURIComponent(jogo.codigo)}` }, 'Dashboard'),
      h('button', {
        type: 'button', class: 'botao pequeno', title: 'Copiar a ligação do dashboard em direto, para quem não tem conta',
        onclick: () => partilhar(jogo),
      }, 'Copiar ligação'),
      h('a', { class: 'botao-link suave pequeno', href: `convocatoria.html?jogo=${jogo.id}` }, 'Convocatória'),
      h('a', { class: 'botao-link suave pequeno', href: urlExcel(jogo.id), download: '' }, '⬇ Excel'),
      h('a', { class: 'botao-link suave pequeno', 'data-acao': 'eventos', href: `eventos.html?jogo=${jogo.id}`, title: 'Ver todos os eventos e corrigir os que ficaram mal' }, 'Eventos'),
      h('button', { type: 'button', class: 'botao suave pequeno', 'data-acao': 'editar', onclick: () => { aEditar.add(jogo.id); desenharJogos(); } }, 'Editar'),
      jogo.terminadoEm
        ? h('button', { type: 'button', class: 'botao suave pequeno', 'data-acao': 'reabrir', title: 'Voltar a deixar o banco registar', onclick: () => terminarJogo(jogo, false) }, 'Reabrir')
        : h('button', { type: 'button', class: 'botao suave pequeno', 'data-acao': 'terminar', title: 'Marcar o fim do jogo: o banco deixa de registar', onclick: () => terminarJogo(jogo, true) }, 'Terminar jogo'),
      h('button', { type: 'button', class: 'botao perigo pequeno', 'data-acao': 'apagar', onclick: () => apagarJogo(jogo) }, 'Apagar')),
    aEditar.has(jogo.id) && formularioEdicao(jogo),
    h('label', {
      class: 'opcao-jogo',
      title: 'Quem não tem conta vê este jogo na área de convidado durante 24 horas, sem precisar da ligação',
    }, caixaVisivel, 'Mostrar na área de convidado'));
}

/** Conta ainda sem jogos: mostra os três passos, a começar pelo que falta. */
function estadoVazio(equipas) {
  const temEquipa = equipas.some((e) => e.propria);
  return h('section', { class: 'estado-vazio' },
    h('h2', {}, 'Ainda não tens jogos'),
    h('p', {}, 'Em três passos tens o primeiro jogo a ser registado.'),
    h('ol', { class: 'passos' },
      h('li', {}, h('div', {}, h('strong', {}, temEquipa ? 'Junta os jogadores da tua equipa' : 'Cria a tua equipa'), h('span', {}, 'O plantel fica guardado para todos os jogos.'))),
      h('li', {}, h('div', {}, h('strong', {}, 'Cria o jogo e escolhe os convocados'), h('span', {}, 'Escreve o nome do adversário. Até 16 jogadores por equipa.'))),
      h('li', {}, h('div', {}, h('strong', {}, 'Regista no Banco'), h('span', {}, 'Copia a ligação do dashboard e envia-a ao treinador: vê tudo em direto, sem conta.')))),
    temEquipa
      ? h('button', { type: 'button', class: 'botao primario', onclick: () => { novoJogo.open = true; campoAdversario.focus(); } }, 'Criar o primeiro jogo')
      : h('a', { class: 'botao-link primario', href: 'equipas.html' }, 'Criar a minha equipa'));
}

function desenharJogos() {
  tituloJogos.hidden = jogosAtuais.length === 0;
  substituir(contentor, jogosAtuais.length
    ? h('ul', { class: 'lista-jogos' }, jogosAtuais.map(linhaJogo))
    : estadoVazio(equipasDaConta));
}

async function carregarJogos(equipas) {
  try {
    jogosAtuais = await obter('/api/jogos');
    desenharJogos();
  } catch (erro) {
    const guardados = erro.status == null ? jogosGuardados() : [];
    if (guardados.length === 0) {
      substituir(contentor, h('p', { class: 'vazio' }, `Não foi possível carregar os jogos: ${erro.message}`));
      return;
    }
    // Sem rede: os jogos que este tablet já abriu no banco continuam a abrir
    tituloJogos.hidden = false;
    substituir(contentor,
      h('p', { class: 'vazio' }, 'Sem rede. Estes jogos abrem no banco com os dados guardados neste tablet:'),
      h('ul', { class: 'lista-jogos' }, guardados.map((jogo) => h('li', { class: 'jogo-linha' },
        h('div', { class: 'info' }, h('div', { class: 'equipas' },
          h('span', { class: 'equipa-nome' }, jogo.casaNome), h('span', { class: 'contra' }, 'vs'),
          h('span', { class: 'equipa-nome' }, jogo.foraNome))),
        h('div', { class: 'acoes-jogo' }, h('a', { class: 'botao-link primario pequeno', href: `banco.html?jogo=${jogo.id}` }, 'Banco'))))));
  }
}

async function carregarEquipas() {
  try {
    return await obter('/api/equipas');
  } catch (erro) {
    erroJogo.textContent = `Não foi possível carregar as equipas: ${erro.message}`;
    novoJogo.hidden = false;
    botaoCriar.disabled = true;
    return [];
  }
}

function prepararFormulario(equipas) {
  // O jogo é sempre da equipa da conta contra um adversário: sem equipa da conta não há jogo para criar
  const minha = equipas.find((e) => e.propria);
  novoJogo.hidden = !minha && !erroJogo.textContent;
  if (!minha) return;

  textoEquipa.replaceChildren('A tua equipa: ', h('strong', {}, minha.nome));
  // os adversários que já usaste aparecem como sugestão (assim o plantel deles é reaproveitado)
  substituir(listaAdversarios, equipas.filter((e) => !e.propria).map((e) => h('option', { value: e.nome })));
}

const mesmoNome = (a, b) => a.trim().toLocaleLowerCase('pt-PT') === b.trim().toLocaleLowerCase('pt-PT');

/** O adversário é uma equipa da conta: reaproveita a que já existe com esse nome ou cria-a agora. */
async function equipaAdversaria(nome, equipas) {
  const existente = equipas.find((e) => !e.propria && mesmoNome(e.nome, nome));
  if (existente) return existente.id;
  try {
    return (await enviar('POST', '/api/equipas', { nome })).id;
  } catch (erro) {
    // pode já existir com outras maiúsculas ou ter sido criada noutro separador: volta a procurar
    const atuais = await obter('/api/equipas');
    const igual = atuais.find((e) => !e.propria && mesmoNome(e.nome, nome));
    if (igual) return igual.id;
    throw erro;
  }
}

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  erroJogo.textContent = '';

  const minha = equipasDaConta.find((e) => e.propria);
  const adversario = campoAdversario.value.trim();
  if (!minha) { erroJogo.textContent = 'Cria primeiro a tua equipa.'; return; }
  if (!adversario) { erroJogo.textContent = 'Escreve o nome do adversário.'; return; }
  if (adversario.length > 80) { erroJogo.textContent = 'O nome do adversário pode ter no máximo 80 caracteres.'; return; }
  if (mesmoNome(adversario, minha.nome)) { erroJogo.textContent = 'O adversário tem de ser outra equipa.'; return; }

  let dataHora = null;
  const escolhida = document.getElementById('data-hora').value;
  if (escolhida) {
    const data = new Date(escolhida); // hora local do tablet
    if (Number.isNaN(data.getTime())) { erroJogo.textContent = 'Data e hora inválidas.'; return; }
    dataHora = data.toISOString();
  }

  botaoCriar.disabled = true;
  try {
    const adversarioId = await equipaAdversaria(adversario, equipasDaConta);
    const emCasa = ladoJogo.value === 'casa';
    const criado = await enviar('POST', '/api/jogos', {
      casaId: emCasa ? minha.id : adversarioId, foraId: emCasa ? adversarioId : minha.id,
      local: document.getElementById('local').value.trim() || null, dataHora,
    });
    location.assign(`convocatoria.html?jogo=${criado.id}`);
  } catch (erro) {
    erroJogo.textContent = erro.message;
    botaoCriar.disabled = false;
  }
});

let equipasDaConta = await carregarEquipas();
prepararFormulario(equipasDaConta);
await carregarJogos(equipasDaConta);

desenharFila();
if (fila.contar() > 0) envio.tentar();
window.addEventListener('online', () => { if (fila.contar() > 0) envio.tentar(); });
setInterval(() => { if (fila.contar() > 0) envio.tentar(); }, 15000);
