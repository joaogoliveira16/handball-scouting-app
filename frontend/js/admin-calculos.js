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
 */
export function acoesDaConta(conta, euId) {
  if (!conta || conta.id === euId) return { propria: true, repor: false, papel: null, ativa: null };
  const desativada = conta.estado === 'desativado';
  let papel = null;
  if (conta.papel === 'admin') papel = 'normal';
  else if (conta.estado === 'ativo') papel = 'admin';
  return { propria: false, repor: !desativada, papel, ativa: desativada };
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
    default:
      return '';
  }
}

/** A mensagem do aviso depois de a ação correr bem. */
export function avisoDaAcao(acao, conta) {
  switch (acao) {
    case 'repor': return `Enviámos a ligação para ${conta.email}.`;
    case 'admin': return `${conta.nome} é agora admin.`;
    case 'normal': return `${conta.nome} deixou de ser admin.`;
    case 'desativar': return `Conta de ${conta.nome} desativada.`;
    case 'ativar': return `Conta de ${conta.nome} ativada.`;
    default: return 'Feito.';
  }
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

/** Ligação para a página de eventos do jogo, no modo de administração (corrige o jogo de qualquer conta). */
export function ligacaoDosEventos(jogoId) {
  return `eventos.html?jogo=${jogoId}&admin=1`;
}

// ------------------------------------------------------------------ registo

export const FILTROS_REGISTO = [
  { codigo: '', rotulo: 'Tudo' },
  { codigo: 'evento', rotulo: 'Eventos' },
  { codigo: 'conta', rotulo: 'Contas' },
];

/** Pesquisa no registo (quem fez, o quê e o detalhe). */
export function filtrarRegisto(linhas, texto = '') {
  return (linhas ?? []).filter((l) => corresponde(texto, [l.autorNome, l.acao, l.detalhe]));
}
