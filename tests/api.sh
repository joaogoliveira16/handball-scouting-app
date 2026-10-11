#!/usr/bin/env bash
# Arranca e pára a API publicada (tests/publicado) para os testes de integração no CI.
#   tests/api.sh arrancar   -> publica (se preciso), arranca em http://localhost:5080 e espera por /api/saude
#   tests/api.sh parar
set -euo pipefail
cd "$(dirname "$0")/.."

PASTA=tests/publicado
RESULTADOS=tests/resultados
PID=$RESULTADOS/api.pid
mkdir -p "$RESULTADOS"

case "${1:-}" in
  arrancar)
    if [ ! -f "$PASTA/HandballScouting.Api.dll" ]; then
      dotnet publish api/HandballScouting.Api/HandballScouting.Api.csproj -c Release -o "$PASTA" --nologo -v minimal
    fi
    export ConnectionStrings__Default="Host=${PGHOST:-localhost};Port=5432;Database=${PGDATABASE:-scouting};Username=${PGUSER:-scouting};Password=${PGPASSWORD:-scouting}"
    export ASPNETCORE_URLS="http://localhost:5080"
    export Exportacao__FusoHorario="Europe/Lisbon"
    nohup dotnet "$PASTA/HandballScouting.Api.dll" >> "$RESULTADOS/api.log" 2>&1 &
    echo $! > "$PID"
    for _ in $(seq 1 60); do
      if curl -fsS http://localhost:5080/api/saude >/dev/null 2>&1; then echo "API pronta."; exit 0; fi
      if ! kill -0 "$(cat "$PID")" 2>/dev/null; then echo "A API terminou ao arrancar:"; tail -n 40 "$RESULTADOS/api.log"; exit 1; fi
      sleep 1
    done
    echo "A API não respondeu em 60 s:"; tail -n 40 "$RESULTADOS/api.log"; exit 1
    ;;
  parar)
    if [ -f "$PID" ]; then kill "$(cat "$PID")" 2>/dev/null || true; rm -f "$PID"; sleep 1; fi
    ;;
  *)
    echo "uso: $0 arrancar|parar"; exit 2
    ;;
esac
