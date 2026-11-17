#!/usr/bin/env bash
# Cópia de segurança e restauro (scripts/backup e scripts/restaurar): o que o pg_dump guarda volta igual com o pg_restore,
# com as mesmas opções dos scripts, numa base de dados vazia e também por cima de uma com dados diferentes
# (a que se estraga com um erro e se quer repor). Compara, tabela a tabela, o conteúdo todo (colunas calculadas incluídas).
#   PGHOST=localhost PGUSER=scouting PGPASSWORD=scouting bash db/tests/copia_de_seguranca.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

ORIGEM=scouting_copia_origem
DESTINO=scouting_copia_destino
PASTA=$(mktemp -d)
limpar() {
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $ORIGEM WITH (FORCE)" -c "DROP DATABASE IF EXISTS $DESTINO WITH (FORCE)" >/dev/null 2>&1 || true
  rm -rf "$PASTA"
}
trap limpar EXIT

for base in "$ORIGEM" "$DESTINO"; do
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $base WITH (FORCE)" -c "CREATE DATABASE $base"
done
for f in db/init/*.sql; do psql -X -v ON_ERROR_STOP=1 -q -d "$ORIGEM" -f "$f" >/dev/null; done

# Dados de todos os tipos: contas (uma admin), equipa com escudo, jogo com remates (coordenadas, baliza), relógio e registo
psql -X -v ON_ERROR_STOP=1 -q -d "$ORIGEM" >/dev/null <<'SQL'
DO $$
DECLARE
    v_conta INT;
    v_adv   INT;
    v_equipa INT;
    v_jogador INT;
    v_jogo  INT;
BEGIN
    v_conta := registar_utilizador('copia@exemplo.pt', 'Conta da Cópia', 'hash-copia', 'Equipa da Cópia');
    UPDATE utilizadores SET email_verificado_em = now(), papel = 'admin' WHERE id = v_conta;
    SELECT equipa_id INTO v_equipa FROM utilizadores WHERE id = v_conta;
    INSERT INTO equipas (nome, dono_id) VALUES ('Adversária da Cópia', v_conta) RETURNING id INTO v_adv;
    INSERT INTO escudos (equipa_id, tipo, dados) VALUES (v_equipa, 'image/png', '\x89504e470d0a1a0a'::bytea);
    INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo) VALUES (v_equipa, 7, 'Sete da Cópia', 'LE') RETURNING id INTO v_jogador;
    INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id, data_hora) VALUES (v_equipa, v_adv, v_conta, now()) RETURNING id INTO v_jogo;
    INSERT INTO convocados (jogo_id, jogador_id) VALUES (v_jogo, v_jogador);
    INSERT INTO relogios_jogo (jogo_id, segundo, a_correr) VALUES (v_jogo, 300, FALSE);
    -- remates em sítios diferentes: as colunas calculadas (corredor, distância, zona da baliza) têm de voltar iguais
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, resultado, x, y, parte, segundo_jogo)
    VALUES (v_jogo, v_equipa, 'REMATE', v_jogador, 'GOLO', 50, 50, 1, 60),
           (v_jogo, v_equipa, 'REMATE', v_jogador, 'FORA', 10, 12, 1, 90),
           (v_jogo, v_equipa, 'REMATE', v_jogador, 'GOLO', 95, 80, 2, 1500);
    INSERT INTO sessoes (token_hash, utilizador_id, expira_em) VALUES (repeat('9', 64), v_conta, now() + interval '1 day');
    INSERT INTO registo_alteracoes (autor_id, autor_nome, tipo, acao, detalhe, jogo_id)
    VALUES (v_conta, 'Conta da Cópia', 'jogo', 'Jogo terminado', 'Equipa da Cópia vs Adversária da Cópia', v_jogo);
END
$$;
SQL

# O conteúdo de cada tabela numa só linha (md5 das linhas por ordem), para comparar duas bases de dados
impressao() {
  local base=$1 tabela
  while read -r tabela; do
    printf '%s %s\n' "$tabela" "$(psql -X -At -d "$base" -c "SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t::text), '')) FROM public.\"$tabela\" t")"
  done < <(psql -X -At -d "$base" -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")
}
impressao "$ORIGEM" > "$PASTA/origem.txt"
[ "$(wc -l < "$PASTA/origem.txt")" -ge 14 ] || { echo "poucas tabelas na base de origem"; exit 1; }
[ "$(psql -X -At -d "$ORIGEM" -c 'SELECT count(*) FROM eventos')" -ge 3 ] || { echo "faltam eventos na base de origem"; exit 1; }

# Exatamente as opções de scripts/backup.sh e scripts/restaurar.sh
pg_dump -d "$ORIGEM" -Fc -f "$PASTA/copia.dump"
pg_restore -l "$PASTA/copia.dump" > /dev/null
restaurar() { pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error -d "$DESTINO" "$PASTA/copia.dump"; }

restaurar
impressao "$DESTINO" > "$PASTA/destino.txt"
diff "$PASTA/origem.txt" "$PASTA/destino.txt" || { echo "a base restaurada não é igual à original"; exit 1; }

# Por cima de uma base com dados diferentes: o que lá estava desaparece e volta o que estava na cópia
psql -X -v ON_ERROR_STOP=1 -q -d "$DESTINO" >/dev/null <<'SQL'
DELETE FROM eventos;
DELETE FROM relogios_jogo;
DELETE FROM registo_alteracoes;
UPDATE utilizadores SET nome = 'Estragada';
INSERT INTO equipas (nome) VALUES ('Equipa que não estava na cópia');
SQL
restaurar
impressao "$DESTINO" > "$PASTA/destino2.txt"
diff "$PASTA/origem.txt" "$PASTA/destino2.txt" || { echo "restaurar por cima não repôs a cópia"; exit 1; }

# Depois de restaurar a aplicação continua a escrever (as sequências ficaram no sítio certo)
psql -X -v ON_ERROR_STOP=1 -At -d "$DESTINO" >/dev/null <<'SQL'
SELECT registar_utilizador('depois@exemplo.pt', 'Depois', 'hash', 'Equipa Depois');
INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, parte, segundo_jogo)
SELECT j.id, j.equipa_casa_id, 'PERDA_BOLA', 1, 5 FROM jogos j WHERE j.dono_id IS NOT NULL LIMIT 1;
SQL
echo "cópia de segurança e restauro: OK"
