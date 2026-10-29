#!/usr/bin/env bash
# Atualização de uma base de dados que já tinha contas (criada só com os scripts 01 a 07):
# as contas que já existiam ficam com o email confirmado e com a primeira equipa como equipa da conta, as novas nascem
# por confirmar e repetir os scripts não muda nada.
#   PGHOST=localhost PGUSER=scouting PGPASSWORD=scouting bash db/tests/atualizacao.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

BASE=scouting_atualizacao
psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $BASE WITH (FORCE)" -c "CREATE DATABASE $BASE"
trap 'psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $BASE WITH (FORCE)" >/dev/null' EXIT
export PGDATABASE=$BASE

for f in db/init/0[1-7]_*.sql; do psql -X -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null; done
psql -X -v ON_ERROR_STOP=1 -q -c "SELECT registar_utilizador('antiga@exemplo.pt', 'Antiga', 'hash')" >/dev/null
# a conta antiga já tinha duas equipas (antes de existir «a equipa da conta»)
psql -X -v ON_ERROR_STOP=1 -q >/dev/null <<'SQL'
INSERT INTO equipas (nome, dono_id) SELECT 'Equipa da antiga', id FROM utilizadores WHERE email = 'antiga@exemplo.pt';
INSERT INTO equipas (nome, dono_id) SELECT 'Adversária da antiga', id FROM utilizadores WHERE email = 'antiga@exemplo.pt';
-- e a posição ainda tinha o nome de antes do português de Portugal
UPDATE posicoes SET nome = 'Pivô' WHERE codigo = 'PV';
-- e ainda não existia a posição «Universal»
DELETE FROM posicoes WHERE codigo = 'UN';
SQL

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
    ASSERT (SELECT e.nome FROM utilizadores u JOIN equipas e ON e.id = u.equipa_id WHERE u.email = 'antiga@exemplo.pt') = 'Equipa da antiga',
        'a conta que já existia devia ficar com a primeira equipa que tinha como equipa da conta';
    ASSERT (SELECT equipa_id IS NULL FROM utilizadores WHERE email = 'nova@exemplo.pt'),
        'a conta criada sem equipa (versão anterior) fica sem equipa da conta, mesmo depois de repetir os scripts';
    ASSERT (SELECT COUNT(*) > 0 AND bool_and(visivel_convidados) FROM jogos),
        'os jogos que já existiam devem ficar visíveis na área de convidado (podem ser escondidos pelo dono)';
    -- a vista dos remates acaba com todas as colunas, mesmo com os scripts mais antigos a correrem outra vez em cada arranque
    ASSERT (SELECT COUNT(*) = 2 FROM information_schema.columns
            WHERE table_name = 'v_remates' AND column_name IN ('baliza_zona', 'sistema_defensivo')),
        'a vista v_remates devia ter o local na baliza e o sistema defensivo depois de repetir os scripts';
    ASSERT (SELECT COUNT(*) > 0 AND COUNT(terminado_em) = 0 FROM jogos),
        'os jogos que já existiam ficam por terminar (a coluna terminado_em foi acrescentada à base antiga)';
    ASSERT (SELECT nome FROM posicoes WHERE codigo = 'UN') = 'Universal',
        'a posição Universal devia ser acrescentada à base antiga (e repetir os scripts não a duplica)';
    ASSERT (SELECT nome FROM posicoes WHERE codigo = 'PV') = 'Pivot',
        'a posição PV devia chamar-se Pivot (português de Portugal)';
    ASSERT (SELECT papel = 'normal' AND desativado_em IS NULL FROM utilizadores WHERE email = 'antiga@exemplo.pt'),
        'a conta que já existia devia ficar normal e ativa (ninguém passa a admin pela atualização)';
    ASSERT (SELECT COUNT(*) = 0 FROM utilizadores WHERE papel <> 'normal') AND (SELECT COUNT(*) = 0 FROM registo_alteracoes),
        'a atualização não devia dar o papel de admin a ninguém nem deixar linhas no registo (repetir os scripts também não)';
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'eliminar_conta'),
        'a função eliminar_conta devia existir depois da atualização (e repetir os scripts não falha)';
    ASSERT (SELECT COUNT(*) > 0 FROM eventos WHERE jogo_id = 2 AND sistema_defensivo IS NOT NULL),
        'o jogo de exemplo devia ficar com a defesa do adversário marcada nos remates posicionais';
END
$$;
SELECT 'atualização de uma base antiga: OK';
SQL
