// Janela "Ler a lista de uma foto": escolher a imagem, ler o texto, rever os jogadores e confirmar.
// Devolve (promessa) os jogadores confirmados, ou null se a pessoa cancelar. Quem chama é que grava.
// Serve a convocatória (os jogadores da imagem ficam convocados) e o plantel (só se juntam os que ainda não existem).
import { POSICOES } from './api.js';
import { h, substituir } from './dom.js';
import { nomesParecidos } from './lista-jogadores.js';
import { encerrarLeitor, leituraDisponivel, lerImagem } from './ocr.js';

const POSICAO_POR_OMISSAO = 'CE';   // as listas quase nunca trazem a posição: a pessoa ajusta aqui ou em Equipas

/**
 * @param {{equipaNome: string, plantel: {id:number, numero:number, nome:string, posicao:string}[], maximo?: number,
 *   convocadosAtuais?: Set<number>, modo?: 'convocatoria' | 'plantel'}} opcoes
 *   modo 'convocatoria' (a omissão): quem está na imagem fica convocado; "maximo" e "convocadosAtuais" são os da convocatória.
 *   modo 'plantel': só se juntam à equipa os jogadores que ainda não existem; os que já estão ficam como estão.
 * @returns {Promise<null | {jogadores: {jogadorId: number|null, numero: number, nome: string, posicao: string}[]}>}
 *   um jogador com jogadorId já está na equipa (só fica convocado); sem jogadorId é para criar.
 */
export function abrirLeituraDeFoto({ equipaNome, plantel, maximo = 99, convocadosAtuais = new Set(), modo = 'convocatoria' }) {
  const soPlantel = modo === 'plantel';
  return new Promise((resolver) => {
    const anteriorFoco = document.activeElement;
    const corpo = h('div', { class: 'foto-corpo' });
    const janela = h('div', { class: 'janela cartao janela-foto', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'titulo-foto' },
      h('h2', { id: 'titulo-foto' }, 'Ler a lista de uma foto'),
      h('p', { class: 'janela-sub' }, equipaNome),
      corpo);
    const fundo = h('div', { class: 'janela-fundo' }, janela);
    document.body.append(fundo);

    let encerrada = false;
    let leitura = 0;          // número da leitura em curso: uma leitura abandonada não mexe no ecrã
    let urlPrevia = null;
    let linhas = [];
    let textoLido = '';
    let chaveSeguinte = 1;

    function fechar(resultado) {
      if (encerrada) return;
      encerrada = true;
      leitura += 1;
      document.removeEventListener('keydown', aoTeclar);
      document.removeEventListener('paste', aoColar);
      if (urlPrevia) URL.revokeObjectURL(urlPrevia);
      fundo.remove();
      encerrarLeitor();
      anteriorFoco?.focus?.();
      resolver(resultado);
    }
    const aoTeclar = (e) => { if (e.key === 'Escape') fechar(null); };
    document.addEventListener('keydown', aoTeclar);

    // ------------------------------------------------------------------
    // 1. Escolher a imagem
    // ------------------------------------------------------------------
    const entrada = h('input', { type: 'file', accept: 'image/*', hidden: true });
    entrada.addEventListener('change', () => { if (entrada.files?.[0]) ler(entrada.files[0]); entrada.value = ''; });

    function ecraEscolher(mensagem = null) {
      leitura += 1;
      if (!leituraDisponivel()) {
        substituir(corpo,
          h('p', { class: 'aviso-inline erro' }, `Este browser não consegue ler imagens. Atualiza o browser, ou escreve os jogadores ${soPlantel ? 'no formulário' : 'em Equipas'}.`),
          h('div', { class: 'janela-acoes' }, h('button', { type: 'button', class: 'botao suave', onclick: () => fechar(null) }, 'Fechar')));
        return;
      }
      const escolher = h('button', { type: 'button', class: 'botao primario', onclick: () => entrada.click() }, 'Escolher foto ou captura de ecrã');
      substituir(corpo,
        mensagem && h('p', { class: 'aviso-inline erro', role: 'alert' }, mensagem),
        h('p', {}, `Escolhe uma foto ou uma captura de ecrã ${soPlantel ? 'da lista de jogadores (uma convocatória, uma ficha de jogo...)' : 'da convocatória'}. Lê-se melhor com texto impresso, bem iluminado e de frente, sem sombras.`),
        h('p', { class: 'suave' }, 'Também podes arrastar a imagem para aqui ou colar uma captura de ecrã com Ctrl+V. A imagem fica no teu dispositivo: não é enviada para lado nenhum.'),
        entrada,
        h('div', { class: 'janela-acoes' },
          h('button', { type: 'button', class: 'botao suave', onclick: () => fechar(null) }, 'Cancelar'),
          escolher));
      escolher.focus();
    }

    // Arrastar e colar
    janela.addEventListener('dragover', (e) => { e.preventDefault(); });
    janela.addEventListener('drop', (e) => {
      e.preventDefault();
      const ficheiro = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (ficheiro) ler(ficheiro);
    });
    const aoColar = (e) => {
      const ficheiro = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (ficheiro) { e.preventDefault(); ler(ficheiro); }
    };
    document.addEventListener('paste', aoColar);

    // ------------------------------------------------------------------
    // 2. Ler
    // ------------------------------------------------------------------
    async function ler(ficheiro) {
      const minha = ++leitura;
      if (urlPrevia) URL.revokeObjectURL(urlPrevia);
      urlPrevia = URL.createObjectURL(ficheiro);
      const barra = h('progress', { max: '1', value: '0', 'aria-label': 'Progresso da leitura' });
      const estadoLeitura = h('p', { role: 'status' }, 'A preparar o leitor…');
      substituir(corpo,
        h('img', { class: 'foto-previa', src: urlPrevia, alt: 'A imagem escolhida' }),
        estadoLeitura, barra,
        h('div', { class: 'janela-acoes' }, h('button', { type: 'button', class: 'botao suave', onclick: () => fechar(null) }, 'Cancelar')));
      try {
        const resultado = await lerImagem(ficheiro, {
          aoProgresso: ({ fase, progresso, tentativa, total }) => {
            if (minha !== leitura) return;
            barra.value = String(progresso ?? 0);
            if (fase === 'carregar') estadoLeitura.textContent = 'A preparar o leitor… (só demora mais da primeira vez)';
            else estadoLeitura.textContent = `A ler a imagem${tentativa > 1 ? ` (outra tentativa, ${tentativa} de ${total})` : ''}… ${Math.round((progresso ?? 0) * 100)}%`;
          },
        });
        if (minha !== leitura) return;
        textoLido = resultado.texto;
        linhas = resultado.jogadores.map((j) => novaLinha({ numero: j.numero, nome: j.nome, posicao: j.posicao, incluir: !j.repetido, linha: j.linha }));
        ecraRever(resultado.jogadores.length === 0
          ? 'Não consegui ler nenhum jogador nesta imagem. Tenta uma imagem mais nítida e de frente, ou escreve a lista aqui.'
          : null);
      } catch (erro) {
        if (minha !== leitura) return;
        ecraEscolher(erro?.message || 'Não foi possível ler a imagem.');
      }
    }

    // ------------------------------------------------------------------
    // 3. Rever
    // ------------------------------------------------------------------
    function novaLinha({ numero = '', nome = '', posicao = null, incluir = true, linha = '' }) {
      return { chave: chaveSeguinte++, numero, nome, posicao: posicao ?? POSICAO_POR_OMISSAO, incluir, linha };
    }
    const numeroDe = (l) => (l.numero === '' || l.numero == null ? NaN : Number(l.numero));
    const numeroValido = (n) => Number.isInteger(n) && n >= 1 && n <= 99;
    const existenteDe = (l) => (numeroValido(numeroDe(l)) ? plantel.find((j) => j.numero === numeroDe(l)) ?? null : null);

    /** O que está mal na seleção atual (vazio = pode confirmar). */
    function problemas() {
      const incluidas = linhas.filter((l) => l.incluir);
      const erros = [];
      if (incluidas.some((l) => !numeroValido(numeroDe(l)))) erros.push('Há jogadores sem número (tem de estar entre 1 e 99).');
      const numeros = incluidas.map(numeroDe).filter(numeroValido);
      const repetidos = [...new Set(numeros.filter((n, i) => numeros.indexOf(n) !== i))];
      if (repetidos.length) erros.push(`Número repetido: ${repetidos.map((n) => `#${n}`).join(', ')}. Muda o número ou tira um dos dois.`);
      if (incluidas.some((l) => !existenteDe(l) && !String(l.nome).trim())) erros.push('Escreve o nome dos jogadores novos.');
      if (!soPlantel && incluidas.length > maximo) erros.push(`Só cabem ${maximo} convocados por equipa: tira ${incluidas.length - maximo}.`);
      return erros;
    }

    function ecraRever(mensagem = null) {
      leitura += 1;
      const corpoTabela = h('tbody');
      const erros = h('p', { class: 'erro-formulario', role: 'alert' });
      const resumo = h('p', { class: 'resumo-foto', role: 'status' });
      const confirmar = h('button', { type: 'button', class: 'botao primario' });
      confirmar.addEventListener('click', () => {
        if (problemas().length) return;
        fechar({
          jogadores: linhas.filter((l) => l.incluir).map((l) => {
            const existente = existenteDe(l);
            return existente
              ? { jogadorId: existente.id, numero: existente.numero, nome: existente.nome, posicao: existente.posicao }
              : { jogadorId: null, numero: numeroDe(l), nome: String(l.nome).trim().replace(/\s+/g, ' '), posicao: l.posicao };
          }),
        });
      });

      /** Recalcula tudo o que depende das escolhas: estados das linhas, resumo, erros e botão. */
      function atualizar() {
        for (const l of linhas) l.atualizarCelulas?.();
        const incluidas = linhas.filter((l) => l.incluir && numeroValido(numeroDe(l)));
        const novos = incluidas.filter((l) => !existenteDe(l)).length;
        const numerosFicam = new Set(incluidas.map(numeroDe));
        const saem = [...convocadosAtuais].filter((id) => {
          const j = plantel.find((p) => p.id === id);
          return j && !numerosFicam.has(j.numero);
        }).length;
        const lista = problemas();
        erros.textContent = lista.join(' ');
        if (soPlantel) {
          const jaExistem = linhas.filter((l) => numeroValido(numeroDe(l)) && existenteDe(l)).length;
          const jaDiz = jaExistem ? ` ${jaExistem} já ${jaExistem === 1 ? 'está' : 'estão'} na equipa e ${jaExistem === 1 ? 'fica' : 'ficam'} como ${jaExistem === 1 ? 'está' : 'estão'}.` : '';
          resumo.textContent = incluidas.length === 0
            ? `Nenhum jogador novo para adicionar.${jaDiz}`
            : `Vão ser adicionados ${incluidas.length} jogador${incluidas.length === 1 ? '' : 'es'} à equipa.${jaDiz}`;
        } else {
          resumo.textContent = incluidas.length === 0
            ? 'Nenhum jogador escolhido.'
            : `Ficam convocados ${incluidas.length} jogador${incluidas.length === 1 ? '' : 'es'}${novos ? `, ${novos} deles novo${novos === 1 ? '' : 's'} na equipa` : ''}.`
              + (saem ? ` Saem da convocatória ${saem} que estava${saem === 1 ? '' : 'm'} marcado${saem === 1 ? '' : 's'} e não vêm na imagem.` : '');
        }
        confirmar.disabled = lista.length > 0 || linhas.filter((l) => l.incluir).length === 0;
        const acao = soPlantel ? 'Adicionar' : 'Convocar';
        confirmar.textContent = incluidas.length ? `${acao} ${incluidas.length}` : acao;
      }

      function desenharLinha(l) {
        const caixa = h('input', { type: 'checkbox', checked: l.incluir, 'aria-label': 'Convocar este jogador' });
        caixa.addEventListener('change', () => { l.incluir = caixa.checked; atualizar(); });
        const numero = h('input', { type: 'number', class: 'campo-numero', min: '1', max: '99', inputmode: 'numeric', value: l.numero, 'aria-label': 'Número' });
        numero.addEventListener('input', () => { l.numero = numero.value; atualizar(); });
        const celulaNome = h('td');
        const celulaPosicao = h('td');
        const celulaEstado = h('td', { class: 'estado-linha' });

        l.atualizarCelulas = () => {
          const existente = existenteDe(l);
          if (soPlantel) {
            // No plantel quem já existe não tem nada a acrescentar; se o número mudar para um livre, passa a ser um novo
            if (existente) { l.incluir = false; caixa.checked = false; caixa.disabled = true; l.jaExistia = true; }
            else {
              caixa.disabled = false;
              if (l.jaExistia) { l.jaExistia = false; l.incluir = true; caixa.checked = true; }
            }
          }
          if (existente) {
            substituir(celulaNome, h('span', {}, existente.nome),
              l.nome && !nomesParecidos(l.nome, existente.nome) ? h('small', { class: 'nome-lido' }, ` (na imagem: ${l.nome})`) : null);
            substituir(celulaPosicao, h('span', { class: 'suave' }, POSICOES.find((p) => p.codigo === existente.posicao)?.rotulo ?? existente.posicao));
            celulaEstado.textContent = 'Já está na equipa';
            celulaEstado.className = 'estado-linha';
          } else {
            if (!celulaNome.querySelector('input')) {
              const nome = h('input', { type: 'text', maxlength: '80', value: l.nome, 'aria-label': 'Nome' });
              nome.addEventListener('input', () => { l.nome = nome.value; atualizar(); });
              substituir(celulaNome, nome);
            }
            if (!celulaPosicao.querySelector('select')) {
              const posicao = h('select', { 'aria-label': 'Posição' }, POSICOES.map((p) => h('option', { value: p.codigo, selected: p.codigo === l.posicao }, p.rotulo)));
              posicao.addEventListener('change', () => { l.posicao = posicao.value; });
              substituir(celulaPosicao, posicao);
            }
            const n = numeroDe(l);
            const repetido = l.incluir && numeroValido(n) && linhas.some((o) => o !== l && o.incluir && numeroDe(o) === n && o.chave < l.chave);
            celulaEstado.textContent = !numeroValido(n) ? 'Falta o número' : repetido ? 'Número repetido' : 'Novo na equipa';
            celulaEstado.className = `estado-linha${!numeroValido(n) || repetido ? ' alerta' : ' novo'}`;
          }
        };
        return h('tr', { title: l.linha ? `Lido: ${l.linha}` : null }, h('td', {}, caixa), h('td', {}, numero), celulaNome, celulaPosicao, celulaEstado);
      }

      function desenharTabela() {
        substituir(corpoTabela, linhas.map(desenharLinha));
        atualizar();
      }

      const adicionar = h('button', { type: 'button', class: 'botao suave pequeno', onclick: () => {
        const l = novaLinha({});
        linhas.push(l);
        corpoTabela.append(desenharLinha(l));
        atualizar();
        corpoTabela.lastElementChild.querySelector('input[type=number]').focus();
      } }, 'Adicionar jogador');

      substituir(corpo,
        mensagem && h('p', { class: 'aviso-inline' }, mensagem),
        h('p', {}, soPlantel
          ? 'Confirma o que foi lido. Corrige o que estiver mal e tira a marca a quem não queres adicionar. Os jogadores que já estão na equipa ficam como estão.'
          : 'Confirma o que foi lido. Corrige o que estiver mal e tira a marca a quem não joga. Os jogadores que ainda não existem na equipa são adicionados.'),
        h('div', { class: 'tabela-rolagem' },
          h('table', { class: 'tabela lista-foto' },
            h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'N.º'), h('th', {}, 'Nome'), h('th', {}, 'Posição'), h('th', {}, 'Estado'))),
            corpoTabela)),
        h('p', { class: 'suave pequeno-texto' }, `Jogadores novos sem posição na imagem ficam como ${POSICOES.find((p) => p.codigo === POSICAO_POR_OMISSAO).rotulo.toLowerCase()}: muda-a aqui ou depois ${soPlantel ? 'com «Editar»' : 'em Equipas'}.`),
        resumo, erros,
        textoLido && h('details', { class: 'texto-lido' }, h('summary', {}, 'Ver o texto lido na imagem'), h('pre', {}, textoLido)),
        h('div', { class: 'janela-acoes' },
          h('button', { type: 'button', class: 'botao suave', onclick: () => fechar(null) }, 'Cancelar'),
          adicionar,
          h('button', { type: 'button', class: 'botao suave', onclick: () => ecraEscolher() }, 'Outra imagem'),
          confirmar));
      desenharTabela();
      confirmar.focus();
    }

    ecraEscolher();
  });
}
