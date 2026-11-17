# Função partilhada por servidor.sh e restaurar.sh (carrega-se com «.», não se corre sozinha).
# Recusa arrancar uma base de dados com a palavra-passe de fábrica: sem isto, quem chega à porta da base de dados
# (ou a um backup do .env) entra com «scouting». Só conta quando a base de dados é criada: depois de existir, mudar
# o .env não muda a palavra-passe que ela tem (ver «Antes de abrir ao público» no README).

# Palavras-passe que vêm de fábrica ou de exemplo, e o mínimo de caracteres
PALAVRAS_PASSE_FRACAS="scouting muda-esta-palavra-passe password postgres 123456"
TAMANHO_MINIMO_PALAVRA_PASSE=12

# exigir_palavra_passe_forte [ficheiro .env]  ->  devolve 1 (com a explicação no stderr) se faltar ou for fraca.
# Vale a variável POSTGRES_PASSWORD do ambiente, se existir (o docker compose também lhe dá prioridade); senão a do .env.
exigir_palavra_passe_forte() {
  local ficheiro="${1:-.env}" valor="${POSTGRES_PASSWORD-}" fraca
  if [ -z "$valor" ] && [ -f "$ficheiro" ]; then
    valor=$(grep -E '^[[:space:]]*POSTGRES_PASSWORD=' "$ficheiro" | tail -n 1 | cut -d= -f2- | tr -d '\r')
    valor="${valor#\"}"; valor="${valor%\"}"; valor="${valor#\'}"; valor="${valor%\'}"   # o compose tira as aspas
  fi

  if [ -z "$valor" ]; then
    echo "ERRO: não há POSTGRES_PASSWORD no $ficheiro. Sem ela, a base de dados fica com a palavra-passe de fábrica («scouting»)." >&2
    valor=""
  else
    for fraca in $PALAVRAS_PASSE_FRACAS; do
      [ "$valor" = "$fraca" ] || continue
      echo "ERRO: a POSTGRES_PASSWORD é «$fraca», uma palavra-passe de fábrica ou de exemplo." >&2
      valor=""; break
    done
    if [ -n "$valor" ] && [ "${#valor}" -lt "$TAMANHO_MINIMO_PALAVRA_PASSE" ]; then
      echo "ERRO: a POSTGRES_PASSWORD tem só ${#valor} caracteres; usa pelo menos $TAMANHO_MINIMO_PALAVRA_PASSE." >&2
      valor=""
    fi
    [ -z "$valor" ] || return 0
  fi

  cat >&2 <<AJUDA
Põe no $ficheiro uma linha POSTGRES_PASSWORD=... com uma palavra-passe forte, só letras e números (sem espaços nem ; ou =).
Gera uma assim:   echo "POSTGRES_PASSWORD=\$(openssl rand -hex 16)" >> $ficheiro
(se o ficheiro já tiver a linha POSTGRES_PASSWORD=, apaga-a antes.) Tem de ser feito antes de a base de dados ser criada;
se já existe, muda-a primeiro dentro dela (README, «Antes de abrir ao público»).
AJUDA
  return 1
}
