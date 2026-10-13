#!/usr/bin/env bash
# Atualização de uma base de dados que já tinha contas (criada só com os scripts 01 a 07):
# as contas que já existiam ficam com o email confirmado, as novas nascem por confirmar e repetir os scripts não muda nada.
#   PGHOST=localhost PGUSER=scouting PGPASSWORD=scouting bash db/tests/atualizacao.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

BASE=scouting_atualizacao
psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $BASE WITH (FORCE)" -c "CREATE DATABASE $BASE"
trap 'psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $BASE WITH (FORCE)" >/dev/null' EXIT
export PGDATABASE=$BASE

for f in db/init/0[1-7]_*.sql; do psql -X -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null; done
psql -X -v ON_ERROR_STOP=1 -q -c "SELECT registar_utilizador('antiga@exemplo.pt', 'Antiga', 'hash')" >/dev/null

# É o que o serviço "migrar" do docker compose faz em cada arranque: corre outra vez os scripts 05 em diante
for volta in 1 2; do
  for f in db/init/0[5-9]_*.sql db/init/[1-9][0-9]_*.sql; do psql -X -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null; done
  if [ "$volta" = 1 ]; then
    psql -X -v ON_ERROR_STOP=1 -q -c "SELECT registar_utilizador('nova@exemplo.pt', 'Nova', 'hash')" >/dev/null
  fi
done

psql -X -v ON_ERROR_STOP=1 -At <<'SQL'
DO $$
BEGIN
    ASSERT (SELECT email_verificado_em IS NOT NULL FROM utilizadores WHERE email = 'antiga@exemplo.pt'),
        'a conta que já existia devia ficar com o email confirmado';
    ASSERT (SELECT email_verificado_em IS NULL FROM utilizadores WHERE email = 'nova@exemplo.pt'),
        'a conta criada depois da atualização devia ficar por confirmar (e continuar assim depois de repetir os scripts)';
    ASSERT (SELECT COUNT(*) > 0 AND bool_and(visivel_convidados) FROM jogos),
        'os jogos que já existiam devem ficar visíveis na área de convidado (podem ser escondidos pelo dono)';
END
$$;
SELECT 'atualização de uma base antiga: OK';
SQL
