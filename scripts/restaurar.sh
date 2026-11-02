#!/usr/bin/env bash
# Restaura uma cópia feita com scripts/backup.sh. ATENÇÃO: SUBSTITUI todos os dados atuais pelos da cópia.
#   bash scripts/restaurar.sh backups/scouting-20261029-183000.dump [--sim]
# Sem --sim pergunta antes. Pára a API durante a restauração (para não haver ligações abertas) e volta a arrancá-la;
# se a cópia for de uma versão mais antiga, o serviço "migrar" atualiza a base de dados ao arrancar.
# A restauração é feita numa só transação: se algo falhar, a base de dados fica como estava.
set -euo pipefail
cd "$(dirname "$0")/.."

ficheiro="${1:-}"
if [ -z "$ficheiro" ] || [ ! -f "$ficheiro" ]; then
  echo "Uso: bash scripts/restaurar.sh <ficheiro.dump> [--sim]" >&2
  exit 1
fi

if [ "${2:-}" != "--sim" ]; then
  echo "Isto SUBSTITUI todos os dados atuais pelos da cópia $ficheiro."
  echo "Dica: faz antes uma cópia dos dados atuais com: bash scripts/backup.sh"
  read -r -p "Escreve «sim» para continuar: " resposta
  if [ "$resposta" != "sim" ]; then
    echo "Cancelado: nada foi alterado."
    exit 1
  fi
fi

docker compose up -d db
for _ in $(seq 1 30); do
  docker compose exec -T db pg_isready -q && break
  sleep 1
done
docker compose exec -T db pg_isready -q   # falha aqui se a base de dados não arrancou

docker compose stop api
docker compose cp "$ficheiro" db:/tmp/restaurar.dump
docker compose exec -T db sh -c 'pg_restore -l /tmp/restaurar.dump > /dev/null'   # confere que o ficheiro se consegue ler
docker compose exec -T db sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error -U $POSTGRES_USER -d $POSTGRES_DB /tmp/restaurar.dump'
docker compose exec -T db rm -f /tmp/restaurar.dump

docker compose run --rm migrar   # atualiza o esquema se a cópia for de uma versão mais antiga (é repetível)
docker compose up -d

echo "Cópia restaurada a partir de $ficheiro"
