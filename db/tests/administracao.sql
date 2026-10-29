-- Testes da administração: papéis, contas desativadas, registo de alterações e as consultas de /api/admin.
--   psql -v ON_ERROR_STOP=1 -f db/tests/administracao.sql      (a partir da raiz do projeto)
-- Corre dentro de uma transação que é desfeita no fim (não deixa dados).
--
-- As consultas são as verdadeiras (api/HandballScouting.Api/Sql/*.sql): lêem-se do disco e os parâmetros do Dapper
-- (@nome) passam a parâmetros do PostgreSQL ($1, $2...) para as executar aqui com EXECUTE ... USING.

\set q_papel      `cat api/HandballScouting.Api/Sql/admin_definir_papel.sql`
\set q_ativa      `cat api/HandballScouting.Api/Sql/admin_definir_ativa.sql`
\set q_promover   `cat api/HandballScouting.Api/Sql/admin_promover_emails.sql`
\set q_sessao     `cat api/HandballScouting.Api/Sql/utilizador_da_sessao.sql`
\set q_redefinir  `cat api/HandballScouting.Api/Sql/utilizador_para_redefinir.sql`
\set q_email      `cat api/HandballScouting.Api/Sql/utilizador_por_email.sql`
\set q_contas     `cat api/HandballScouting.Api/Sql/admin_utilizadores.sql`
\set q_registar   `cat api/HandballScouting.Api/Sql/admin_registar_alteracao.sql`
\set q_registo    `cat api/HandballScouting.Api/Sql/admin_registo.sql`
\set q_jogos      `cat api/HandballScouting.Api/Sql/admin_jogos.sql`
\set q_dono       `cat api/HandballScouting.Api/Sql/admin_dono_do_jogo.sql`
\set q_eliminar   `cat api/HandballScouting.Api/Sql/admin_eliminar_conta.sql`

BEGIN;

-- @nome -> $1, $2... (pela ordem dos nomes) e sem o ponto e vírgula do fim
CREATE FUNCTION pg_temp.preparar(texto TEXT, VARIADIC nomes TEXT[] DEFAULT '{}') RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    r TEXT := regexp_replace(texto, ';\s*$', '');
    i INT;
BEGIN
    FOR i IN 1..COALESCE(array_length(nomes, 1), 0) LOOP
        r := regexp_replace(r, '@' || nomes[i] || '\y', '$' || i, 'g');
    END LOOP;
    RETURN r;
END
$$;

SELECT set_config('q.papel',     pg_temp.preparar(:'q_papel', 'papel', 'id'), true),
       set_config('q.ativa',     pg_temp.preparar(:'q_ativa', 'ativa', 'id'), true),
       set_config('q.promover',  pg_temp.preparar(:'q_promover', 'emails'), true),
       set_config('q.sessao',    pg_temp.preparar(:'q_sessao', 'tokenHash'), true),
       set_config('q.redefinir', pg_temp.preparar(:'q_redefinir', 'email'), true),
       set_config('q.email',     pg_temp.preparar(:'q_email', 'email'), true),
       set_config('q.contas',    pg_temp.preparar(:'q_contas', 'id'), true),
       set_config('q.registar',  pg_temp.preparar(:'q_registar', 'autorId', 'autorNome', 'tipo', 'acao', 'detalhe', 'jogoId'), true),
       set_config('q.registo',   pg_temp.preparar(:'q_registo', 'tipo', 'limite'), true),
       set_config('q.jogos',     pg_temp.preparar(:'q_jogos'), true),
       set_config('q.dono',      pg_temp.preparar(:'q_dono', 'jogoId'), true),
       set_config('q.eliminar',  pg_temp.preparar(:'q_eliminar', 'id'), true)
\gset

DO $$
DECLARE
    v_a INT;   -- admin
    v_b INT;   -- conta normal
    v_c INT;   -- conta por confirmar
    v_id INT;
    v_n  INT;
    v_texto TEXT;
    v_bool BOOLEAN;
    v_jogo INT;
    v_adversaria INT;
    v_d INT;   -- conta a eliminar
    v_equipa_d INT;
    v_adv_d INT;
    v_jogador_d INT;
    v_jogador_ad INT;
    v_jogo_d INT;
    v_jogo_antigo INT;
    v_eq INT;
    v_jg INT;
    v_jo INT;
    v_outros_jogos INT;
    v_outras_equipas INT;
BEGIN
    -- Ponto de partida: nenhuma conta e tudo sem dono (como numa base acabada de criar)
    DELETE FROM sessoes;
    UPDATE jogos SET dono_id = NULL;
    UPDATE equipas SET dono_id = NULL;
    DELETE FROM utilizadores;
    DELETE FROM registo_alteracoes;

    v_a := registar_utilizador('ana@exemplo.pt', 'Ana', 'hash-a', 'Equipa da Ana');
    v_b := registar_utilizador('bruno@exemplo.pt', 'Bruno', 'hash-b', 'Equipa do Bruno');
    v_c := registar_utilizador('carla@exemplo.pt', 'Carla', 'hash-c', 'Equipa da Carla');
    UPDATE utilizadores SET email_verificado_em = now() WHERE id IN (v_a, v_b);   -- a Carla não confirmou

    -- Por omissão: papel normal e conta ativa
    ASSERT (SELECT papel FROM utilizadores WHERE id = v_a) = 'normal', 'uma conta nova devia ser normal';
    ASSERT (SELECT desativado_em IS NULL FROM utilizadores WHERE id = v_a), 'uma conta nova devia estar ativa';

    -- O papel só pode ser normal ou admin
    BEGIN
        UPDATE utilizadores SET papel = 'dono' WHERE id = v_a;
        RAISE EXCEPTION 'devia ter recusado o papel «dono»';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- ------------------------------------------------------------ emails da configuração
    -- Só passam a admin as contas confirmadas, ativas e que ainda não são admin; devolve os emails promovidos
    EXECUTE current_setting('q.promover') INTO v_texto USING ARRAY['carla@exemplo.pt', 'ninguem@exemplo.pt'];
    ASSERT v_texto IS NULL, 'a Carla não confirmou o email: não devia passar a admin';
    EXECUTE current_setting('q.promover') INTO v_texto USING ARRAY['ana@exemplo.pt', 'ninguem@exemplo.pt'];
    ASSERT v_texto = 'ana@exemplo.pt', 'a Ana devia passar a admin (devolve o email)';
    ASSERT (SELECT papel FROM utilizadores WHERE id = v_a) = 'admin', 'a Ana devia ter o papel admin';
    EXECUTE current_setting('q.promover') INTO v_texto USING ARRAY['ana@exemplo.pt'];
    ASSERT v_texto IS NULL, 'quem já é admin não se promove outra vez (nada a devolver, nada a registar)';
    UPDATE utilizadores SET desativado_em = now() WHERE id = v_a;
    UPDATE utilizadores SET papel = 'normal' WHERE id = v_a;
    EXECUTE current_setting('q.promover') INTO v_texto USING ARRAY['ana@exemplo.pt'];
    ASSERT v_texto IS NULL, 'uma conta desativada não passa a admin';
    UPDATE utilizadores SET desativado_em = NULL WHERE id = v_a;
    EXECUTE current_setting('q.promover') INTO v_texto USING ARRAY['ana@exemplo.pt'];
    ASSERT v_texto = 'ana@exemplo.pt', 'depois de ativada a Ana volta a ser promovida';

    -- ------------------------------------------------------------ mudar o papel (nunca fica a app sem admin ativo)
    EXECUTE current_setting('q.papel') INTO v_id USING 'normal', v_a;
    ASSERT v_id IS NULL, 'a Ana é o único admin: não pode perder o papel';
    ASSERT (SELECT papel FROM utilizadores WHERE id = v_a) = 'admin', 'a Ana devia continuar admin';

    EXECUTE current_setting('q.papel') INTO v_id USING 'admin', v_c;
    ASSERT v_id = v_c, 'a consulta dá o papel (a regra de a conta estar ativa e confirmada é do AdminService)';
    ASSERT (SELECT COUNT(*) FROM utilizadores WHERE papel = 'admin') = 2, 'devia haver 2 admins';
    EXECUTE current_setting('q.papel') INTO v_id USING 'admin', v_c;
    ASSERT v_id IS NULL, 'dar o papel que a conta já tem não muda nada';
    -- A Carla não confirmou o email: não conta como admin ativo. A Ana continua a ser a única.
    EXECUTE current_setting('q.papel') INTO v_id USING 'normal', v_a;
    ASSERT v_id IS NULL, 'um admin por confirmar não conta: a Ana continua a ser a única e não perde o papel';

    EXECUTE current_setting('q.papel') INTO v_id USING 'admin', v_b;
    ASSERT v_id = v_b, 'o Bruno devia passar a admin';
    EXECUTE current_setting('q.papel') INTO v_id USING 'normal', v_a;
    ASSERT v_id = v_a, 'havendo outro admin ativo, a Ana pode perder o papel';
    ASSERT (SELECT papel FROM utilizadores WHERE id = v_a) = 'normal', 'a Ana devia ficar normal';

    -- Um admin desativado também não conta
    UPDATE utilizadores SET desativado_em = now() WHERE id = v_a;
    UPDATE utilizadores SET papel = 'admin' WHERE id = v_a;
    EXECUTE current_setting('q.papel') INTO v_id USING 'normal', v_b;
    ASSERT v_id IS NULL, 'a Ana está desativada: o Bruno é o único admin ativo e não perde o papel';
    UPDATE utilizadores SET desativado_em = NULL WHERE id = v_a;
    EXECUTE current_setting('q.papel') INTO v_id USING 'normal', v_b;
    ASSERT v_id = v_b, 'com a Ana ativa outra vez o Bruno já pode perder o papel';

    -- ------------------------------------------------------------ desativar e ativar
    INSERT INTO sessoes (token_hash, utilizador_id, expira_em) VALUES
        (repeat('1', 64), v_b, now() + interval '1 day'),
        (repeat('2', 64), v_a, now() + interval '1 day');
    EXECUTE 'SELECT id, nome FROM (' || current_setting('q.sessao') || ') s' INTO v_id, v_texto USING repeat('1', 64);
    ASSERT v_id = v_b AND v_texto = 'Bruno', 'a sessão do Bruno devia servir';
    EXECUTE 'SELECT admin FROM (' || current_setting('q.sessao') || ') s' INTO v_bool USING repeat('2', 64);
    ASSERT v_bool IS TRUE, 'a sessão da Ana diz que ela é admin';
    EXECUTE 'SELECT admin FROM (' || current_setting('q.sessao') || ') s' INTO v_bool USING repeat('1', 64);
    ASSERT v_bool IS FALSE, 'e a do Bruno que não é';

    EXECUTE current_setting('q.ativa') INTO v_id USING FALSE, v_b;
    ASSERT v_id = v_b, 'desativar o Bruno devia devolver o id';
    ASSERT (SELECT desativado_em IS NOT NULL FROM utilizadores WHERE id = v_b), 'e guardar a data';
    EXECUTE current_setting('q.ativa') INTO v_id USING FALSE, v_b;
    ASSERT v_id IS NULL, 'desativar uma conta já desativada não muda nada';
    EXECUTE current_setting('q.ativa') INTO v_id USING TRUE, v_a;
    ASSERT v_id IS NULL, 'ativar uma conta já ativa não muda nada';
    EXECUTE current_setting('q.ativa') INTO v_id USING FALSE, 999999;
    ASSERT v_id IS NULL, 'uma conta que não existe não muda nada';

    -- A sessão de uma conta desativada deixa de servir logo, sem apagar a linha
    EXECUTE 'SELECT count(*) FROM (' || current_setting('q.sessao') || ') s' INTO v_n USING repeat('1', 64);
    ASSERT v_n = 0, 'uma conta desativada não tem sessão válida';
    ASSERT (SELECT COUNT(*) FROM sessoes WHERE utilizador_id = v_b) = 1, 'a linha da sessão ainda lá está (quem desativa é que as apaga)';
    DELETE FROM sessoes WHERE utilizador_id = v_b;
    ASSERT (SELECT COUNT(*) FROM sessoes WHERE utilizador_id = v_a) = 1, 'as sessões de outra conta ficam';

    -- Não recebe o link de recuperação, mas o email da conta continua a existir para entrar (o API diz porquê)
    EXECUTE 'SELECT count(*) FROM (' || current_setting('q.redefinir') || ') s' INTO v_n USING 'bruno@exemplo.pt';
    ASSERT v_n = 0, 'uma conta desativada não recebe o link de recuperação da palavra-passe';
    EXECUTE 'SELECT count(*) FROM (' || current_setting('q.redefinir') || ') s' INTO v_n USING 'carla@exemplo.pt';
    ASSERT v_n = 1, 'uma conta por confirmar continua a receber o link';
    EXECUTE 'SELECT desativado FROM (' || current_setting('q.email') || ') s' INTO v_bool USING 'bruno@exemplo.pt';
    ASSERT v_bool IS TRUE, 'a consulta do email diz que a conta está desativada';
    EXECUTE 'SELECT admin FROM (' || current_setting('q.email') || ') s' INTO v_bool USING 'ana@exemplo.pt';
    ASSERT v_bool IS TRUE, 'e que a Ana é admin';

    EXECUTE current_setting('q.ativa') INTO v_id USING TRUE, v_b;
    ASSERT v_id = v_b, 'ativar o Bruno devia devolver o id';
    ASSERT (SELECT desativado_em IS NULL FROM utilizadores WHERE id = v_b), 'e limpar a data';

    -- ------------------------------------------------------------ lista de contas
    EXECUTE 'SELECT estado FROM (' || current_setting('q.contas') || ') s' INTO v_texto USING v_a;
    ASSERT v_texto = 'ativo', 'a Ana está ativa';
    EXECUTE 'SELECT estado FROM (' || current_setting('q.contas') || ') s' INTO v_texto USING v_c;
    ASSERT v_texto = 'por_confirmar', 'a Carla está por confirmar';
    UPDATE utilizadores SET desativado_em = now() WHERE id = v_b;
    EXECUTE 'SELECT estado FROM (' || current_setting('q.contas') || ') s' INTO v_texto USING v_b;
    ASSERT v_texto = 'desativado', 'o Bruno está desativado (mesmo estando confirmado)';
    EXECUTE 'SELECT count(*) FROM (' || current_setting('q.contas') || ') s' INTO v_n USING NULL::int;
    ASSERT v_n = 3, 'sem id vêm todas as contas';
    EXECUTE 'SELECT count(*) FROM (' || current_setting('q.contas') || ') s' INTO v_n USING v_a;
    ASSERT v_n = 1, 'com id vem só essa conta';
    EXECUTE 'SELECT equipa FROM (' || current_setting('q.contas') || ') s' INTO v_texto USING v_a;
    ASSERT v_texto = 'Equipa da Ana', 'a lista traz o nome da equipa da conta';
    EXECUTE 'SELECT papel FROM (' || current_setting('q.contas') || ') s' INTO v_texto USING v_c;
    ASSERT v_texto = 'admin', 'e o papel';

    -- ------------------------------------------------------------ jogos de todas as contas
    INSERT INTO equipas (nome, dono_id) VALUES ('Adversária da Ana', v_a) RETURNING id INTO v_adversaria;
    INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id, data_hora)
    SELECT equipa_id, v_adversaria, v_a, now() FROM utilizadores WHERE id = v_a
    RETURNING id INTO v_jogo;
    EXECUTE 'SELECT dono_nome FROM (' || current_setting('q.jogos') || ') s WHERE id = $1' INTO v_texto USING v_jogo;
    ASSERT v_texto = 'Ana', 'a lista de jogos traz o nome da conta dona';
    EXECUTE 'SELECT eventos FROM (' || current_setting('q.jogos') || ') s WHERE id = $1' INTO v_n USING v_jogo;
    ASSERT v_n = 0, 'um jogo novo não tem eventos';
    EXECUTE current_setting('q.dono') INTO v_id, v_texto USING v_jogo;
    ASSERT v_id = v_a AND v_texto = 'Ana', 'o dono do jogo é a Ana';
    UPDATE jogos SET dono_id = NULL WHERE id = v_jogo;
    EXECUTE current_setting('q.dono') INTO v_id USING v_jogo;
    ASSERT v_id IS NULL, 'um jogo sem dono não se corrige pela administração';
    EXECUTE 'SELECT dono_nome FROM (' || current_setting('q.jogos') || ') s WHERE id = $1' INTO v_texto USING v_jogo;
    ASSERT v_texto IS NULL, 'mas aparece na lista, sem conta dona';

    -- ------------------------------------------------------------ eliminar uma conta e tudo o que é dela
    v_d := registar_utilizador('dora@exemplo.pt', 'Dora', 'hash-d', 'Equipa da Dora');
    SELECT equipa_id INTO v_equipa_d FROM utilizadores WHERE id = v_d;
    INSERT INTO equipas (nome, dono_id) VALUES ('Adversária da Dora', v_d) RETURNING id INTO v_adv_d;
    INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo) VALUES (v_equipa_d, 7, 'Dora Sete', 'LE') RETURNING id INTO v_jogador_d;
    INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo) VALUES (v_adv_d, 9, 'Adversária Nove', 'LE') RETURNING id INTO v_jogador_ad;
    INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id, data_hora) VALUES (v_equipa_d, v_adv_d, v_d, now()) RETURNING id INTO v_jogo_d;
    INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id, data_hora) VALUES (v_equipa_d, v_adv_d, v_d, now());
    INSERT INTO convocados (jogo_id, jogador_id) VALUES (v_jogo_d, v_jogador_d);
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, guarda_redes_id, resultado, x, y, parte, segundo_jogo)
    VALUES (v_jogo_d, v_equipa_d, 'REMATE', v_jogador_d, v_jogador_ad, 'GOLO', 50, 50, 1, 60);
    INSERT INTO escudos (equipa_id, tipo, dados) VALUES (v_equipa_d, 'image/png', '\x89504e47'::bytea);
    INSERT INTO sessoes (token_hash, utilizador_id, expira_em) VALUES (repeat('3', 64), v_d, now() + interval '1 day');
    -- Um jogo antigo, sem dono, que usa uma equipa da Dora (de antes de haver contas)
    INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id, data_hora) VALUES (v_equipa_d, v_adv_d, NULL, now()) RETURNING id INTO v_jogo_antigo;

    -- O que é de outras contas não se toca: a Ana (admin) e o Bruno
    SELECT count(*) INTO v_outros_jogos FROM jogos WHERE dono_id IS DISTINCT FROM v_d AND id <> v_jogo_antigo;
    SELECT count(*) INTO v_outras_equipas FROM equipas WHERE dono_id IS DISTINCT FROM v_d;

    -- Um admin não se elimina (perde primeiro o papel), e uma conta que não existe também não
    EXECUTE 'SELECT count(*) FROM (' || current_setting('q.eliminar') || ') s' INTO v_n USING v_a;
    ASSERT v_n = 0, 'uma conta de admin não se elimina';
    ASSERT EXISTS (SELECT 1 FROM utilizadores WHERE id = v_a), 'a Ana continua a existir';
    EXECUTE 'SELECT count(*) FROM (' || current_setting('q.eliminar') || ') s' INTO v_n USING 999999;
    ASSERT v_n = 0, 'uma conta que não existe não devolve nada';
    ASSERT (SELECT count(*) FROM jogos WHERE dono_id = v_d) = 2, 'recusar não apagou nada à Dora';

    EXECUTE current_setting('q.eliminar') INTO v_eq, v_jg, v_jo USING v_d;
    ASSERT v_eq = 2 AND v_jg = 2 AND v_jo = 3, format('devolve o que saiu: 2 equipas, 2 jogadores e 3 jogos (veio %s, %s, %s)', v_eq, v_jg, v_jo);
    ASSERT NOT EXISTS (SELECT 1 FROM utilizadores WHERE id = v_d), 'a conta saiu';
    ASSERT NOT EXISTS (SELECT 1 FROM equipas WHERE dono_id = v_d), 'as equipas saíram';
    ASSERT NOT EXISTS (SELECT 1 FROM equipas WHERE id IN (v_equipa_d, v_adv_d)), 'a equipa da conta e o adversário saíram';
    ASSERT NOT EXISTS (SELECT 1 FROM jogadores WHERE id IN (v_jogador_d, v_jogador_ad)), 'os jogadores saíram';
    ASSERT NOT EXISTS (SELECT 1 FROM jogos WHERE id IN (v_jogo_d, v_jogo_antigo) OR dono_id = v_d), 'os jogos saíram, também o antigo sem dono';
    ASSERT NOT EXISTS (SELECT 1 FROM eventos WHERE jogo_id = v_jogo_d), 'os eventos saíram';
    ASSERT NOT EXISTS (SELECT 1 FROM convocados WHERE jogo_id = v_jogo_d), 'a convocatória saiu';
    ASSERT NOT EXISTS (SELECT 1 FROM escudos WHERE equipa_id = v_equipa_d), 'o escudo saiu';
    ASSERT NOT EXISTS (SELECT 1 FROM sessoes WHERE utilizador_id = v_d), 'as sessões saíram';
    ASSERT (SELECT count(*) FROM utilizadores) = 3, 'as outras 3 contas ficam';
    ASSERT (SELECT count(*) FROM jogos) = v_outros_jogos, 'os jogos de outras contas ficam';
    ASSERT (SELECT count(*) FROM equipas) = v_outras_equipas, 'as equipas de outras contas ficam';
    EXECUTE current_setting('q.eliminar') INTO v_eq USING v_d;
    ASSERT v_eq IS NULL, 'eliminar outra vez a mesma conta não faz nada';

    -- ------------------------------------------------------------ registo de alterações
    EXECUTE current_setting('q.registar') USING v_a, 'Ana', 'conta', 'Conta desativada', 'bruno@exemplo.pt', NULL::int;
    EXECUTE current_setting('q.registar') USING v_a, 'Ana', 'evento', 'Evento corrigido', 'um jogo', v_jogo;
    EXECUTE current_setting('q.registar') USING NULL::int, 'Sistema', 'conta', 'Papel alterado', 'ana@exemplo.pt (configuração)', NULL::int;
    ASSERT (SELECT COUNT(*) FROM registo_alteracoes) = 3, 'devia haver 3 linhas no registo';
    EXECUTE 'SELECT count(*) FROM (' || current_setting('q.registo') || ') s' INTO v_n USING NULL::text, 100;
    ASSERT v_n = 3, 'sem tipo vêm todas as linhas';
    EXECUTE 'SELECT count(*) FROM (' || current_setting('q.registo') || ') s' INTO v_n USING 'evento', 100;
    ASSERT v_n = 1, 'só os eventos';
    EXECUTE 'SELECT count(*) FROM (' || current_setting('q.registo') || ') s' INTO v_n USING 'conta', 100;
    ASSERT v_n = 2, 'só as contas';
    EXECUTE 'SELECT count(*) FROM (' || current_setting('q.registo') || ') s' INTO v_n USING NULL::text, 2;
    ASSERT v_n = 2, 'o limite corta a lista';
    EXECUTE 'SELECT acao FROM (' || current_setting('q.registo') || ') s' INTO v_texto USING NULL::text, 100;
    ASSERT v_texto = 'Papel alterado', 'a linha mais recente vem primeiro (mesmo com a mesma hora, a de id maior)';
    ASSERT (SELECT jogo_id FROM registo_alteracoes WHERE acao = 'Evento corrigido') = v_jogo, 'a linha do evento guarda o jogo';

    BEGIN
        EXECUTE current_setting('q.registar') USING v_a, 'Ana', 'outro', 'Ação', '', NULL::int;
        RAISE EXCEPTION 'devia ter recusado o tipo «outro»';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- O registo sobrevive a uma conta apagada: o nome de quem agiu fica copiado na linha
    DELETE FROM sessoes WHERE utilizador_id = v_a;
    UPDATE jogos SET dono_id = NULL WHERE dono_id = v_a;
    UPDATE equipas SET dono_id = NULL WHERE dono_id = v_a;
    UPDATE utilizadores SET equipa_id = NULL WHERE id = v_a;
    DELETE FROM utilizadores WHERE id = v_a;
    ASSERT (SELECT COUNT(*) FROM registo_alteracoes WHERE autor_nome = 'Ana') = 2, 'as linhas da Ana ficam, com o nome dela';
    ASSERT (SELECT COUNT(*) FROM registo_alteracoes WHERE autor_id IS NULL) = 3, 'mas deixam de apontar para a conta apagada';
END
$$;

ROLLBACK;
SELECT 'administração: OK';
