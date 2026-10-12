-- Testes da confirmação do email: códigos dos links, validade, quem adota os dados de exemplo.
--   psql -v ON_ERROR_STOP=1 -f db/tests/confirmacao.sql
-- Corre dentro de uma transação que é desfeita no fim (não deixa dados).

BEGIN;

DO $$
DECLARE
    v_a        INT;
    v_b        INT;
    v_c        INT;
    v_quando   TIMESTAMPTZ;
    v_equipa   INT;
    v_equipas  INT;
BEGIN
    -- Ponto de partida: nenhuma conta e tudo sem dono (como numa base acabada de criar)
    DELETE FROM sessoes;
    UPDATE jogos SET dono_id = NULL;
    UPDATE equipas SET dono_id = NULL;
    DELETE FROM utilizadores;
    SELECT COUNT(*) INTO v_equipas FROM equipas;

    -- Uma conta nova nasce por confirmar
    v_a := registar_utilizador('ana@exemplo.pt', 'Ana', 'hash-a');
    v_b := registar_utilizador('bruno@exemplo.pt', 'Bruno', 'hash-b');
    ASSERT (SELECT COUNT(*) FROM utilizadores WHERE email_verificado_em IS NULL) = 2, 'as contas novas deviam nascer por confirmar';

    INSERT INTO verificacoes_email (token_hash, utilizador_id, expira_em) VALUES
        (repeat('a', 64), v_a, now() + interval '1 day'),
        (repeat('b', 64), v_b, now() + interval '1 day'),
        (repeat('e', 64), v_a, now() - interval '1 minute');

    -- Códigos que não existem ou que já expiraram não confirmam nada
    ASSERT confirmar_email(repeat('f', 64)) IS NULL, 'um código desconhecido não devia confirmar';
    ASSERT confirmar_email(repeat('e', 64)) IS NULL, 'um código expirado não devia confirmar';
    ASSERT (SELECT email_verificado_em FROM utilizadores WHERE id = v_a) IS NULL, 'a Ana devia continuar por confirmar';
    ASSERT (SELECT COUNT(*) FROM equipas WHERE dono_id IS NOT NULL) = 0, 'sem confirmação ninguém adota nada';

    -- O Bruno é o primeiro a confirmar: fica com tudo o que não tinha dono
    ASSERT confirmar_email(repeat('b', 64)) = v_b, 'o código do Bruno devia confirmar a conta dele';
    v_quando := (SELECT email_verificado_em FROM utilizadores WHERE id = v_b);
    ASSERT v_quando IS NOT NULL, 'o Bruno devia ficar confirmado';
    ASSERT (SELECT COUNT(*) FROM equipas WHERE dono_id = v_b) = v_equipas, 'a primeira conta confirmada devia ficar com todas as equipas';
    ASSERT (SELECT COUNT(*) FROM jogos WHERE dono_id IS DISTINCT FROM v_b) = 0, 'a primeira conta confirmada devia ficar com todos os jogos';

    -- A Ana confirma depois: fica confirmada mas não leva nada
    ASSERT confirmar_email(repeat('a', 64)) = v_a, 'o código da Ana devia confirmar a conta dela';
    ASSERT (SELECT email_verificado_em FROM utilizadores WHERE id = v_a) IS NOT NULL, 'a Ana devia ficar confirmada';
    ASSERT (SELECT COUNT(*) FROM equipas WHERE dono_id = v_a) = 0, 'a segunda conta confirmada não adota nada';

    -- Abrir o link outra vez continua a dar a conta, sem mudar a data e sem adotar mais nada
    INSERT INTO equipas (nome) VALUES ('Sem dono') RETURNING id INTO v_equipa;
    ASSERT confirmar_email(repeat('b', 64)) = v_b, 'repetir o código devia continuar a dar a conta';
    ASSERT (SELECT email_verificado_em FROM utilizadores WHERE id = v_b) = v_quando, 'a data da confirmação não devia mudar';
    ASSERT (SELECT dono_id FROM equipas WHERE id = v_equipa) IS NULL, 'repetir o código não devia adotar equipas novas';

    -- Um código só existe uma vez
    BEGIN
        INSERT INTO verificacoes_email (token_hash, utilizador_id, expira_em) VALUES (repeat('a', 64), v_b, now() + interval '1 day');
        ASSERT FALSE, 'o código repetido devia ser recusado';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    -- Se a primeira conta confirmada for apagada, a seguinte a confirmar já não "é a primeira" (os dados ficaram com dono)
    v_c := registar_utilizador('carla@exemplo.pt', 'Carla', 'hash-c');
    INSERT INTO verificacoes_email (token_hash, utilizador_id, expira_em) VALUES (repeat('c', 64), v_c, now() + interval '1 day');
    ASSERT confirmar_email(repeat('c', 64)) = v_c, 'o código da Carla devia confirmar a conta dela';
    ASSERT (SELECT dono_id FROM equipas WHERE id = v_equipa) IS NULL, 'a Carla não devia adotar a equipa sem dono (a Ana e o Bruno já estavam confirmados)';

    -- Apagar a conta apaga os códigos
    DELETE FROM equipas WHERE id = v_equipa;
    UPDATE jogos SET dono_id = NULL WHERE dono_id = v_b;
    UPDATE equipas SET dono_id = NULL WHERE dono_id = v_b;
    DELETE FROM utilizadores WHERE id = v_b;
    ASSERT (SELECT COUNT(*) FROM verificacoes_email WHERE utilizador_id = v_b) = 0, 'apagar a conta devia apagar os códigos';
    ASSERT confirmar_email(repeat('b', 64)) IS NULL, 'o código de uma conta apagada não devia confirmar nada';
END
$$;

SELECT 'testes da confirmação do email: OK' AS resultado;

ROLLBACK;
