-- Testes da recuperação da palavra-passe: códigos dos links, validade, uso único, sessões e confirmação do email.
--   psql -v ON_ERROR_STOP=1 -f db/tests/redefinir.sql
-- Corre dentro de uma transação que é desfeita no fim (não deixa dados).

BEGIN;

DO $$
DECLARE
    v_a      INT;
    v_b      INT;
    v_c      INT;
    v_equipa INT;
BEGIN
    -- Ponto de partida: nenhuma conta e tudo sem dono (como numa base acabada de criar)
    DELETE FROM sessoes;
    UPDATE jogos SET dono_id = NULL;
    UPDATE equipas SET dono_id = NULL;
    DELETE FROM utilizadores;

    v_a := registar_utilizador('ana@exemplo.pt', 'Ana', 'hash-antigo-a');
    v_b := registar_utilizador('bruno@exemplo.pt', 'Bruno', 'hash-antigo-b');
    UPDATE utilizadores SET email_verificado_em = now() WHERE id = v_a;   -- a Ana já confirmou; o Bruno não

    INSERT INTO sessoes (token_hash, utilizador_id, expira_em) VALUES
        (repeat('1', 64), v_a, now() + interval '1 day'),
        (repeat('2', 64), v_a, now() + interval '1 day'),
        (repeat('3', 64), v_b, now() + interval '1 day');
    INSERT INTO redefinicoes_palavra_passe (token_hash, utilizador_id, expira_em) VALUES
        (repeat('a', 64), v_a, now() + interval '1 hour'),
        (repeat('b', 64), v_a, now() + interval '1 hour'),     -- um segundo pedido da mesma conta
        (repeat('e', 64), v_a, now() - interval '1 minute'),   -- já expirou
        (repeat('c', 64), v_b, now() + interval '1 hour');

    -- Códigos que não existem ou que já expiraram não mudam nada
    ASSERT redefinir_palavra_passe(repeat('f', 64), 'hash-novo') IS NULL, 'um código desconhecido não devia redefinir';
    ASSERT redefinir_palavra_passe(repeat('e', 64), 'hash-novo') IS NULL, 'um código expirado não devia redefinir';
    ASSERT (SELECT palavra_passe_hash FROM utilizadores WHERE id = v_a) = 'hash-antigo-a', 'a palavra-passe da Ana devia continuar igual';
    ASSERT (SELECT COUNT(*) FROM sessoes WHERE utilizador_id = v_a) = 2, 'as sessões da Ana deviam continuar';

    -- Um código bom muda a palavra-passe, termina as sessões e gasta todos os códigos da conta
    ASSERT redefinir_palavra_passe(repeat('a', 64), 'hash-novo-a') = v_a, 'o código da Ana devia redefinir a conta dela';
    ASSERT (SELECT palavra_passe_hash FROM utilizadores WHERE id = v_a) = 'hash-novo-a', 'a palavra-passe da Ana devia mudar';
    ASSERT (SELECT COUNT(*) FROM sessoes WHERE utilizador_id = v_a) = 0, 'mudar a palavra-passe devia terminar as sessões da conta';
    ASSERT (SELECT COUNT(*) FROM redefinicoes_palavra_passe WHERE utilizador_id = v_a) = 0, 'os códigos da Ana deviam ficar gastos';
    ASSERT (SELECT COUNT(*) FROM sessoes WHERE utilizador_id = v_b) = 1, 'as sessões de outra conta não se mexem';
    ASSERT (SELECT palavra_passe_hash FROM utilizadores WHERE id = v_b) = 'hash-antigo-b', 'a palavra-passe de outra conta não muda';

    -- Só funciona uma vez, mesmo com outro código da mesma conta
    ASSERT redefinir_palavra_passe(repeat('a', 64), 'hash-roubado') IS NULL, 'o mesmo código não devia funcionar duas vezes';
    ASSERT redefinir_palavra_passe(repeat('b', 64), 'hash-roubado') IS NULL, 'os outros códigos da conta também ficam gastos';
    ASSERT (SELECT palavra_passe_hash FROM utilizadores WHERE id = v_a) = 'hash-novo-a', 'a palavra-passe da Ana devia continuar a nova';

    -- O link chegou ao email do Bruno: a conta fica confirmada e, sendo a primeira confirmada além da Ana, não adota nada
    INSERT INTO equipas (nome) VALUES ('Sem dono') RETURNING id INTO v_equipa;
    ASSERT (SELECT email_verificado_em FROM utilizadores WHERE id = v_b) IS NULL, 'o Bruno devia começar por confirmar';
    ASSERT redefinir_palavra_passe(repeat('c', 64), 'hash-novo-b') = v_b, 'o código do Bruno devia redefinir a conta dele';
    ASSERT (SELECT email_verificado_em FROM utilizadores WHERE id = v_b) IS NOT NULL, 'redefinir a palavra-passe devia confirmar o email';
    ASSERT (SELECT dono_id FROM equipas WHERE id = v_equipa) IS NULL, 'o Bruno não é a primeira conta confirmada: não adota nada';

    -- Se ninguém tiver confirmado ainda, quem redefinir primeiro (e portanto prova o email) é a primeira conta confirmada
    UPDATE utilizadores SET email_verificado_em = NULL;
    v_c := registar_utilizador('carla@exemplo.pt', 'Carla', 'hash-antigo-c');
    INSERT INTO redefinicoes_palavra_passe (token_hash, utilizador_id, expira_em) VALUES (repeat('d', 64), v_c, now() + interval '1 hour');
    ASSERT redefinir_palavra_passe(repeat('d', 64), 'hash-novo-c') = v_c, 'o código da Carla devia redefinir a conta dela';
    ASSERT (SELECT dono_id FROM equipas WHERE id = v_equipa) = v_c, 'a primeira conta confirmada (por redefinição) adota o que não tem dono';

    -- Um código só existe uma vez
    BEGIN
        INSERT INTO redefinicoes_palavra_passe (token_hash, utilizador_id, expira_em) VALUES (repeat('d', 64), v_c, now() + interval '1 hour');
        INSERT INTO redefinicoes_palavra_passe (token_hash, utilizador_id, expira_em) VALUES (repeat('d', 64), v_a, now() + interval '1 hour');
        ASSERT FALSE, 'o código repetido devia ser recusado';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    -- Apagar a conta apaga os códigos
    INSERT INTO redefinicoes_palavra_passe (token_hash, utilizador_id, expira_em) VALUES (repeat('9', 64), v_a, now() + interval '1 hour');
    UPDATE jogos SET dono_id = NULL WHERE dono_id = v_a;
    UPDATE equipas SET dono_id = NULL WHERE dono_id = v_a;
    DELETE FROM utilizadores WHERE id = v_a;
    ASSERT (SELECT COUNT(*) FROM redefinicoes_palavra_passe WHERE utilizador_id = v_a) = 0, 'apagar a conta devia apagar os códigos';
    ASSERT redefinir_palavra_passe(repeat('9', 64), 'hash-x') IS NULL, 'o código de uma conta apagada não devia redefinir nada';
END
$$;

SELECT 'redefinir.sql: OK';

ROLLBACK;
