// As contas da página de administração (admin.js desenha; aqui decide-se). Sem DOM, para se testar à parte
// (tests/unidade/admin.test.mjs). As regras de quem pode fazer o quê espelham as da API (AdminService.cs): a API é que manda,
// isto só evita mostrar botões que a API ia recusar.

/** Minúsculas e sem acentos, para a pesquisa não depender de como se escreve («joao» encontra «João»). */
export function normalizar(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Todas as palavras escritas na pesquisa têm de aparecer em algum dos campos (por qualquer ordem). */
export function corresponde(texto, campos) {
  const palavras = normalizar(texto).split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return true;
  const alvo = normalizar(campos.filter((c) => c != null).join(' '));
  return palavras.every((p) => alvo.includes(p));
}

// ------------------------------------------------------------------ contas

export const ESTADOS = {
  ativo: 'Ativa',
  por_confirmar: 'Por confirmar',
  desativado: 'Desativada',
};

export const PAPEIS = { normal: 'Normal', admin: 'Admin' };

export const FILTROS_CONTAS = [
  { codigo: 'todas', rotulo: 'Todas' },
  { codigo: 'ativas', rotulo: 'Ativas' },
  { codigo: 'admins', rotulo: 'Admins' },
  { codigo: 'por_confirmar', rotulo: 'Por confirmar' },
  { codigo: 'desativadas', rotulo: 'Desativadas' },
];

/** Os números do topo da página. */
export function contarContas(contas) {
  const lista = contas ?? [];
  return {
    total: lista.length,
    ativas: lista.filter((c) => c.estado === 'ativo').length,
    admins: lista.filter((c) => c.papel === 'admin' && c.estado !== 'desativado').length,
    porConfirmar: lista.filter((c) => c.estado === 'por_confirmar').length,
    desativadas: lista.filter((c) => c.estado === 'desativado').length,
  };
}

function passaFiltroDeConta(conta, filtro) {
  switch (filtro) {
    case 'ativas': return conta.estado === 'ativo';
    case 'admins': return conta.papel === 'admin';
    case 'por_confirmar': return conta.estado === 'por_confirmar';
    case 'desativadas': return conta.estado === 'desativado';
    default: return true;
  }
}

/** As contas que a pesquisa (nome, email ou equipa) e o filtro deixam ver, pela ordem recebida. */
export function filtrarContas(contas, { texto = '', filtro = 'todas' } = {}) {
  return (contas ?? []).filter((c) => passaFiltroDeConta(c, filtro) && corresponde(texto, [c.nome, c.email, c.equipa]));
}

/**
 * O que se pode fazer a uma conta. `euId` é a conta de quem está na página: ninguém mexe na própria conta.
 *   repor  - enviar a ligação para escolher outra palavra-passe (não vale para contas desativadas)
 *   papel  - 'admin' (tornar admin), 'normal' (tirar o papel) ou null; só uma conta ativa pode passar a admin
 *   ativa  - false (desativar), true (voltar a ativar)
 *   eliminar - apagar a conta e tudo o que é dela; um admin perde primeiro o papel
 *   editar   - mudar o nome e o email; um admin perde primeiro o papel
 *   exportar - descarregar a cópia de segurança (JSON) com tudo o que é da conta
 */
export function acoesDaConta(conta, euId) {
  if (!conta || conta.id === euId) return { propria: true, repor: false, papel: null, ativa: null, eliminar: false, editar: false, exportar: false };
  const desativada = conta.estado === 'desativado';
  let papel = null;
  if (conta.papel === 'admin') papel = 'normal';
  else if (conta.estado === 'ativo') papel = 'admin';
  return {
    propria: false, repor: !desativada, papel, ativa: desativada,
    eliminar: conta.papel !== 'admin', editar: conta.papel !== 'admin', exportar: true,
  };
}

/** O email escrito para confirmar que se elimina a conta: tem de ser o dela (sem espaços nem maiúsculas a mais). */
export function emailConfere(escrito, conta) {
  const certo = String(conta?.email ?? '').trim().toLowerCase();
  return certo !== '' && String(escrito ?? '').trim().toLowerCase() === certo;
}

/** A frase de confirmação de cada ação (diz o que vai acontecer, e a quem). */
export function confirmacao(acao, conta) {
  const quem = `${conta.nome} (${conta.email})`;
  switch (acao) {
    case 'repor':
      return `Enviar a ${quem} um email com a ligação para escolher outra palavra-passe? A palavra-passe atual continua a servir até a pessoa escolher outra.`;
    case 'admin':
      return `Tornar ${quem} admin? Passa a ver todas as contas e jogos e a poder corrigi-los.`;
    case 'normal':
      return `Tirar o papel de admin a ${quem}?`;
    case 'desativar':
      return `Desativar a conta de ${quem}? A sessão termina já e a pessoa deixa de entrar. Os jogos e equipas ficam como estão.`;
    case 'ativar':
      return `Voltar a ativar a conta de ${quem}?`;
    case 'eliminar':
      return `Eliminar a conta de ${quem}? Isto apaga também as equipas, os jogadores e os jogos dela, e não se pode desfazer. `
        + `Antes de eliminar, o browser guarda uma cópia de segurança (um ficheiro .json) com tudo o que é da conta. `
        + `Se só queres que a pessoa deixe de entrar, usa «Desativar». Para eliminar, escreve o email da conta:`;
    default:
      return '';
  }
}

/** A mensagem do aviso depois de a ação correr bem. `copia` é o nome do ficheiro da cópia de segurança, se houve. */
export function avisoDaAcao(acao, conta, copia = null) {
  if (acao === 'eliminar') return `Conta de ${conta.nome} eliminada.${copia ? ` Cópia de segurança guardada: ${copia}.` : ''}`;
  switch (acao) {
    case 'repor': return `Enviámos a ligação para ${conta.email}.`;
    case 'admin': return `${conta.nome} é agora admin.`;
    case 'normal': return `${conta.nome} deixou de ser admin.`;
    case 'desativar': return `Conta de ${conta.nome} desativada.`;
    case 'ativar': return `Conta de ${conta.nome} ativada.`;
    default: return 'Feito.';
  }
}

/** Valida o nome e o email escritos ao editar uma conta (a API volta a validar). Devolve a frase do erro ou null. */
export function erroDaEdicao({ nome, email }, conta) {
  const n = String(nome ?? '').trim();
  const e = String(email ?? '').trim().toLowerCase();
  if (n === '') return 'Escreve o nome.';
  if (n.length > 80) return 'O nome tem no máximo 80 caracteres.';
  if (e === '') return 'Escreve o email.';
  if (e.length > 160 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return 'O email não é válido.';
  if (conta && n === conta.nome && e === conta.email) return 'Não mudaste nada.';
  return null;
}

/** O aviso depois de editar uma conta: se o email mudou, diz que a conta ficou por confirmar e se o email novo saiu. */
export function avisoDaEdicao(resultado, conta, email) {
  if (!resultado?.emailMudou) return `Conta de ${conta.nome} atualizada.`;
  return resultado.emailEnviado
    ? `Conta atualizada. O email mudou para ${email}: a conta ficou por confirmar e enviámos-lhe a ligação de confirmação.`
    : `Conta atualizada. O email mudou para ${email} e a conta ficou por confirmar, mas o email com a ligação não saiu: a pessoa pode pedir outro na página de entrada.`;
}

/** O nome do ficheiro que a API manda no cabeçalho Content-Disposition (ou `padrao` se não vier). */
export function nomeDoFicheiro(cabecalho, padrao = 'copia.json') {
  const texto = String(cabecalho ?? '');
  const codificado = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(texto);
  if (codificado) {
    try { return decodeURIComponent(codificado[1].trim()); } catch { /* cai para o nome simples */ }
  }
  const simples = /filename="?([^";]+)"?/.exec(texto);
  return simples ? simples[1].trim() : padrao;
}

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/**
 * Quando a conta usou a app pela última vez, em palavras («há 3 h», «ontem»). A API só regista no máximo uma vez por hora,
 * por isso não há minutos. Sem registo: «–».
 */
export function descreverUltimoAcesso(iso, agora = new Date()) {
  if (!iso) return '–';
  const quando = new Date(iso);
  const passou = new Date(agora).getTime() - quando.getTime();
  if (Number.isNaN(passou)) return '–';
  if (passou < HORA) return 'na última hora';
  if (passou < DIA) return `há ${Math.floor(passou / HORA)} h`;
  const dias = Math.floor(passou / DIA);
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  return quando.toLocaleDateString('pt-PT', { dateStyle: 'medium' });
}

// ------------------------------------------------------------------ emails

/**
 * O que a faixa dos emails diz, a partir do estado que a API dá (GET /api/admin/email). `nivel` é «aviso» (os emails não
 * chegam a ninguém, ou as ligações dos emails só abrem neste computador) ou «ok»; `podeTestar` diz se há servidor
 * para onde mandar um email de teste.
 */
export function descreverEmail(estado) {
  if (!estado) return null;
  const local = estado.urlPublicoLocal
    ? ` As ligações dos emails apontam para ${estado.urlPublico}: define URL_PUBLICO no .env com o endereço da app para abrirem noutros aparelhos.`
    : '';
  switch (estado.modo) {
    case 'nao_configurado':
      return {
        nivel: 'aviso', podeTestar: false, titulo: 'Emails por configurar',
        detalhe: 'A app não envia emails (confirmar a conta e repor a palavra-passe não funcionam). Define EMAIL_HOST e as outras variáveis EMAIL_ no .env.',
      };
    case 'teste':
      return {
        nivel: 'aviso', podeTestar: true, titulo: 'Emails: só caixa de teste',
        detalhe: `Os emails ficam na caixa de teste (http://localhost:8025) e não chegam a ninguém. Para enviar a sério, define EMAIL_HOST, EMAIL_UTILIZADOR e EMAIL_SENHA no .env.${local}`,
      };
    default:
      return {
        nivel: local ? 'aviso' : 'ok', podeTestar: true, titulo: `Emails: a enviar por ${estado.host}`,
        detalhe: `De: ${estado.de}.${local}`,
      };
  }
}

/** A mensagem depois de enviar o email de teste (diz onde o ir ver). */
export function avisoDoEmailDeTeste(estado, emailDoAdmin) {
  const onde = estado?.modo === 'teste' ? ' Está na caixa de teste (http://localhost:8025), não na tua caixa de correio.' : ' Vê a tua caixa de correio (e o spam).';
  return `Enviámos um email de teste para ${emailDoAdmin}.${onde}`;
}

// ------------------------------------------------------------------ jogos

export const FILTROS_JOGOS = [
  { codigo: 'todos', rotulo: 'Todos' },
  { codigo: 'a_decorrer', rotulo: 'Por terminar' },
  { codigo: 'terminados', rotulo: 'Terminados' },
];

/** Os jogos que a pesquisa (equipas, conta dona ou local) e o filtro deixam ver. */
export function filtrarJogos(jogos, { texto = '', filtro = 'todos' } = {}) {
  return (jogos ?? []).filter((j) => {
    if (filtro === 'a_decorrer' && j.terminadoEm) return false;
    if (filtro === 'terminados' && !j.terminadoEm) return false;
    return corresponde(texto, [j.casaNome, j.foraNome, j.donoNome, j.local]);
  });
}

/**
 * O que se pode fazer a um jogo. Terminar, reabrir e apagar só valem para jogos de uma conta (os antigos, sem conta,
 * continuam a poder ser exportados, mas não se mexe neles).
 */
export function acoesDoJogo(jogo) {
  const comConta = jogo?.donoId != null;
  const terminado = Boolean(jogo?.terminadoEm);
  return { exportar: true, terminar: comConta && !terminado, reabrir: comConta && terminado, apagar: comConta };
}

function nomeDoJogo(jogo) {
  return `${jogo.casaNome} ${jogo.golosCasa} – ${jogo.golosFora} ${jogo.foraNome}`;
}

/** A frase de confirmação de cada ação sobre um jogo. */
export function confirmacaoDoJogo(acao, jogo) {
  const quem = `${nomeDoJogo(jogo)}${jogo.donoNome ? ` (conta ${jogo.donoNome})` : ''}`;
  switch (acao) {
    case 'terminar':
      return `Dar o jogo ${quem} como terminado? Deixa de estar «por terminar» e a conta dona pode reabri-lo.`;
    case 'reabrir':
      return `Reabrir o jogo ${quem}? Volta a ficar «por terminar».`;
    case 'apagar':
      return `Apagar o jogo ${quem}, ${jogo.eventos === 0 ? 'sem eventos' : jogo.eventos === 1 ? 'com 1 evento' : `com ${jogo.eventos} eventos`}? Não se pode desfazer. `
        + `Antes de apagar, o browser guarda uma cópia de segurança (um ficheiro .json) do jogo. Apagar?`;
    default:
      return '';
  }
}

/** A mensagem do aviso depois de a ação sobre o jogo correr bem. */
export function avisoDoJogo(acao, jogo, copia = null) {
  const nome = `${jogo.casaNome} – ${jogo.foraNome}`;
  switch (acao) {
    case 'terminar': return `Jogo ${nome} terminado.`;
    case 'reabrir': return `Jogo ${nome} reaberto.`;
    case 'apagar': return `Jogo ${nome} apagado.${copia ? ` Cópia de segurança guardada: ${copia}.` : ''}`;
    case 'exportar': return `Cópia de segurança guardada: ${copia}.`;
    default: return 'Feito.';
  }
}

/** Ligação para a página de eventos do jogo, no modo de administração (corrige o jogo de qualquer conta). */
export function ligacaoDosEventos(jogoId) {
  return `eventos.html?jogo=${jogoId}&admin=1`;
}

// ------------------------------------------------------------------ registo

export const FILTROS_REGISTO = [
  { codigo: '', rotulo: 'Tudo' },
  { codigo: 'evento', rotulo: 'Eventos' },
  { codigo: 'conta', rotulo: 'Contas' },
  { codigo: 'jogo', rotulo: 'Jogos' },
];

/** Pesquisa no registo (quem fez, o quê e o detalhe). */
export function filtrarRegisto(linhas, texto = '') {
  return (linhas ?? []).filter((l) => corresponde(texto, [l.autorNome, l.acao, l.detalhe]));
}
