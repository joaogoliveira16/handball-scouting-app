-- Testes das contas: dono das equipas e dos jogos, código de partilha, sessões e adoção dos dados pela primeira conta.
-- (A confirmação do email tem os seus próprios testes em db/tests/confirmacao.sql.)
--   psql -v ON_ERROR_STOP=1 -f db/tests/contas.sql
-- Corre dentro de uma transação que é desfeita no fim (não deixa dados).

BEGIN;

DO $$
DECLARE
    v_a      INT;
    v_b      INT;
    v_eq_a   INT;
    v_eq_b   INT;
    v_eq_a2  INT;
    v_jogo   INT;
    v_codigo TEXT;
    v_n      INT;
    v_equipas INT;
BEGIN
    -- Ponto de partida: nenhuma conta e tudo sem dono (como numa base acabada de criar)
    DELETE FROM sessoes;
    UPDATE jogos SET dono_id = NULL;
    UPDATE equipas SET dono_id = NULL;
    DELETE FROM utilizadores;

    -- Os jogos de exemplo têm um código de partilha único de 20 caracteres
    SELECT COUNT(DISTINCT codigo) INTO v_n FROM jogos;
    ASSERT v_n = (SELECT COUNT(*) FROM jogos), 'cada jogo devia ter o seu código';
    ASSERT (SELECT bool_and(length(codigo) = 20) FROM jogos), 'o código de partilha devia ter 20 caracteres';

    SELECT COUNT(*) INTO v_equipas FROM equipas;

    -- Registar uma conta não adota nada: isso só acontece quando o email é confirmado
    v_a := registar_utilizador('ana@exemplo.pt', 'Ana', 'hash-a');
    ASSERT (SELECT COUNT(*) FROM equipas WHERE dono_id IS NOT NULL) = 0, 'registar não devia dar equipas a ninguém';
    ASSERT (SELECT COUNT(*) FROM jogos WHERE dono_id IS NOT NULL) = 0, 'registar não devia dar jogos a ninguém';

    -- A primeira conta com o email confirmado adota as equipas e os jogos que já existiam
    INSERT INTO verificacoes_email (token_hash, utilizador_id, expira_em) VALUES (repeat('1', 64), v_a, now() + interval '1 day');
    ASSERT confirmar_email(repeat('1', 64)) = v_a, 'o código da Ana devia confirmar a conta dela';
    ASSERT (SELECT COUNT(*) FROM equipas WHERE dono_id IS DISTINCT FROM v_a) = 0, 'a primeira conta devia ficar com todas as equipas';
    ASSERT (SELECT COUNT(*) FROM jogos WHERE dono_id IS DISTINCT FROM v_a) = 0, 'a primeira conta devia ficar com todos os jogos';

    -- A segunda começa vazia e não leva nada
    v_b := registar_utilizador('bruno@exemplo.pt', 'Bruno', 'hash-b');
    ASSERT (SELECT COUNT(*) FROM equipas WHERE dono_id = v_b) = 0, 'a segunda conta devia começar sem equipas';
    ASSERT (SELECT COUNT(*) FROM jogos WHERE dono_id = v_b) = 0, 'a segunda conta devia começar sem jogos';
    ASSERT (SELECT COUNT(*) FROM equipas WHERE dono_id = v_a) = v_equipas, 'a conta da Ana devia manter as equipas que adotou';

    -- Emails repetidos (mesmo com maiúsculas guardadas) são recusados
    BEGIN
        PERFORM registar_utilizador('ana@exemplo.pt', 'Outra', 'x');
        ASSERT FALSE, 'o email repetido devia ser recusado';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    -- O email tem de estar em minúsculas
    BEGIN
        INSERT INTO utilizadores (email, nome, palavra_passe_hash) VALUES ('Maiusculas@Exemplo.pt', 'X', 'x');
        ASSERT FALSE, 'o email com maiúsculas devia ser recusado pela base de dados';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    -- O nome da equipa só é único dentro da mesma conta
    INSERT INTO equipas (nome, dono_id) VALUES ('Águias do Norte', v_b) RETURNING id INTO v_eq_b;   -- a Ana já tem uma com este nome
    BEGIN
        INSERT INTO equipas (nome, dono_id) VALUES ('Águias do Norte', v_b);
        ASSERT FALSE, 'o nome repetido na mesma conta devia ser recusado';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;
    BEGIN
        INSERT INTO equipas (nome, dono_id) VALUES ('Águias do Norte', v_a);
        ASSERT FALSE, 'o nome repetido na conta da Ana devia ser recusado';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    -- Um jogo só pode juntar equipas do mesmo dono
    INSERT INTO equipas (nome, dono_id) VALUES ('Segunda do Bruno', v_b) RETURNING id INTO v_eq_a2;
    INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES (v_eq_b, v_eq_a2, v_b) RETURNING id, codigo INTO v_jogo, v_codigo;
    ASSERT length(v_codigo) = 20, 'o jogo novo devia receber um código de partilha';
    BEGIN
        INSERT INTO jogos (equipa_casa_id, equipa_fora_id, dono_id) VALUES (v_eq_b, 1, v_b);   -- a equipa 1 é da Ana
        ASSERT FALSE, 'não devia ser possível juntar equipas de donos diferentes';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
    BEGIN
        UPDATE jogos SET dono_id = v_a WHERE id = v_jogo;   -- passar o jogo para a Ana sem mudar as equipas
        ASSERT FALSE, 'não devia ser possível passar o jogo para outro dono sem as equipas';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    -- Sessões: um hash por sessão; apagar a conta apaga as sessões
    INSERT INTO sessoes (token_hash, utilizador_id, expira_em)
    VALUES (repeat('a', 64), v_b, now() + interval '1 day'), (repeat('b', 64), v_b, now() - interval '1 day');
    ASSERT (SELECT COUNT(*) FROM sessoes WHERE utilizador_id = v_b AND expira_em > now()) = 1, 'só uma sessão devia estar válida';
    BEGIN
        INSERT INTO sessoes (token_hash, utilizador_id, expira_em) VALUES (repeat('a', 64), v_a, now() + interval '1 day');
        ASSERT FALSE, 'o hash de sessão repetido devia ser recusado';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;
    DELETE FROM jogos WHERE dono_id = v_b;
    DELETE FROM equipas WHERE dono_id = v_b;
    DELETE FROM utilizadores WHERE id = v_b;
    ASSERT (SELECT COUNT(*) FROM sessoes WHERE utilizador_id = v_b) = 0, 'apagar a conta devia apagar as sessões';

    ASSERT (SELECT COUNT(*) FROM utilizadores) = 1, 'devia sobrar só a conta da Ana';
END
$$;

SELECT 'testes das contas: OK' AS resultado;

ROLLBACK;
