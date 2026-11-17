#!/usr/bin/env bash
# Cópia de segurança de TODA a base de dados (contas, equipas, jogadores, jogos, eventos, escudos) para um ficheiro.
# Guarda em backups/scouting-AAAAMMDD-HHMMSS.dump (formato do pg_dump, que o scripts/restaurar.sh lê).
#   bash scripts/backup.sh [pasta]
# Precisa do serviço da base de dados a correr (docker compose up -d). Nada é parado nem alterado.
set -euo pipefail
cd "$(dirname "$0")/.."

pasta="${1:-backups}"
mkdir -p "$pasta"
ficheiro="$pasta/scouting-$(date +%Y%m%d-%H%M%S).dump"

if ! docker compose exec -T db pg_isready -q; then
  echo "A base de dados não está a correr. Arranca-a com: docker compose up -d db" >&2
  exit 1
fi

# O pg_dump corre dentro do contentor (guarda em /tmp) e o ficheiro vem de lá com "docker compose cp":
# redirecionar a saída do pg_dump para um ficheiro, no PowerShell, estraga o ficheiro.
docker compose exec -T db sh -c 'pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc -f /tmp/backup.dump'
docker compose exec -T db sh -c 'pg_restore -l /tmp/backup.dump > /dev/null'   # confere que o ficheiro se consegue ler
docker compose cp db:/tmp/backup.dump "$ficheiro"
docker compose exec -T db rm -f /tmp/backup.dump

echo "Cópia de segurança guardada em $ficheiro ($(du -h "$ficheiro" | cut -f1))"
