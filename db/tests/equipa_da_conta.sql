-- Testes de «uma equipa por conta»: a equipa criada com a conta, a adoção dos dados de exemplo e a equipa de contas antigas.
--   psql -v ON_ERROR_STOP=1 -f db/tests/equipa_da_conta.sql
-- Corre dentro de uma transação que é desfeita no fim (não deixa dados).

BEGIN;

DO $$
DECLARE
    v_a        INT;
    v_b        INT;
    v_c        INT;
    v_equipas  INT;
    v_propria  INT;
    v_nova     INT;
BEGIN
    -- Ponto de partida: nenhuma conta e tudo sem dono (como numa base acabada de criar)
    DELETE FROM sessoes;
    UPDATE jogos SET dono_id = NULL;
    UPDATE equipas SET dono_id = NULL;
    UPDATE utilizadores SET equipa_id = NULL;
    DELETE FROM utilizadores;
    SELECT COUNT(*) INTO v_equipas FROM equipas;

    -- Criar a conta cria a equipa e guarda-a como a equipa da conta (com o nome sem espaços nas pontas).
    -- Escolhe de propósito o nome de uma equipa de exemplo.
    v_a := registar_utilizador('ana@exemplo.pt', 'Ana', 'hash-a', '  Águias do Norte ');
    SELECT equipa_id INTO v_propria FROM utilizadores WHERE id = v_a;
    ASSERT v_propria IS NOT NULL, 'a conta devia ficar com uma equipa';
    ASSERT (SELECT nome FROM equipas WHERE id = v_propria) = 'Águias do Norte', 'o nome da equipa devia ficar sem espaços nas pontas';
    ASSERT (SELECT dono_id FROM equipas WHERE id = v_propria) = v_a, 'a equipa da conta devia ser dela';
    ASSERT (SELECT COUNT(*) FROM equipas WHERE dono_id = v_a) = 1, 'a conta devia ter só a sua equipa';
    ASSERT (SELECT COUNT(*) FROM equipas) = v_equipas + 1, 'devia ter nascido exatamente uma equipa';

    -- Confirmar o email: a primeira conta adota os dados de exemplo, que passam a ser adversárias.
    -- A equipa de exemplo com o mesmo nome da equipa da conta é renomeada (o nome é único por conta).
    INSERT INTO verificacoes_email (token_hash, utilizador_id, expira_em) VALUES (repeat('1', 64), v_a, now() + interval '1 day');
    ASSERT confirmar_email(repeat('1', 64)) = v_a, 'o código da Ana devia confirmar a conta dela';
    ASSERT (SELECT equipa_id FROM utilizadores WHERE id = v_a) = v_propria, 'adotar os dados não muda a equipa da conta';
    ASSERT (SELECT COUNT(*) FROM equipas WHERE dono_id = v_a) = v_equipas + 1, 'a Ana devia ficar com a sua equipa e as de exemplo';
    ASSERT (SELECT COUNT(*) FROM equipas WHERE dono_id IS NULL) = 0, 'nenhuma equipa devia ficar sem dono';
    ASSERT (SELECT nome FROM equipas WHERE id = 1) = 'Águias do Norte (exemplo)', 'a equipa de exemplo com o mesmo nome devia ser renomeada';
    ASSERT (SELECT nome FROM equipas WHERE id = v_propria) = 'Águias do Norte', 'a equipa da conta mantém o nome';
    ASSERT (SELECT COUNT(*) FROM jogos WHERE dono_id = v_a) = (SELECT COUNT(*) FROM jogos), 'a Ana devia ficar com os jogos de exemplo';

    -- A segunda conta só tem a sua equipa; pode ter o mesmo nome que a de outra conta
    v_b := registar_utilizador('bruno@exemplo.pt', 'Bruno', 'hash-b', 'Águias do Norte');
    ASSERT (SELECT COUNT(*) FROM equipas WHERE dono_id = v_b) = 1, 'a segunda conta devia ter só a sua equipa';
    ASSERT (SELECT e.nome FROM utilizadores u JOIN equipas e ON e.id = u.equipa_id WHERE u.id = v_b) = 'Águias do Norte',
        'duas contas podem ter uma equipa com o mesmo nome';
    ASSERT (SELECT COUNT(*) FROM jogos WHERE dono_id = v_b) = 0, 'a segunda conta começa sem jogos';

    -- Um email repetido não deixa nada para trás (nem a equipa)
    BEGIN
        PERFORM registar_utilizador('ana@exemplo.pt', 'Outra', 'x', 'Equipa fantasma');
        ASSERT FALSE, 'o email repetido devia ser recusado';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;
    ASSERT NOT EXISTS (SELECT 1 FROM equipas WHERE nome = 'Equipa fantasma'), 'um registo recusado não devia deixar a equipa';

    -- Sem nome de equipa não há conta
    BEGIN
        PERFORM registar_utilizador('sem-equipa@exemplo.pt', 'Sem', 'x', '   ');
        ASSERT FALSE, 'uma equipa sem nome devia ser recusada';
    EXCEPTION WHEN not_null_violation OR check_violation THEN
        NULL;
    END;
    ASSERT NOT EXISTS (SELECT 1 FROM utilizadores WHERE email = 'sem-equipa@exemplo.pt'), 'um registo recusado não devia deixar a conta';

    -- Conta sem equipa (criada sem o nome da equipa): a primeira equipa que criar passa a ser a da conta,
    -- as seguintes são adversárias (é o que faz o inserir_equipa.sql da API)
    v_c := registar_utilizador('carla@exemplo.pt', 'Carla', 'hash-c');
    ASSERT (SELECT equipa_id IS NULL FROM utilizadores WHERE id = v_c), 'sem nome de equipa a conta fica sem equipa';
    FOR i IN 1..2 LOOP
        WITH nova AS (
            INSERT INTO equipas (nome, dono_id) VALUES ('Equipa ' || i, v_c) RETURNING id
        ), atribuida AS (
            UPDATE utilizadores SET equipa_id = (SELECT id FROM nova) WHERE id = v_c AND equipa_id IS NULL
        )
        SELECT id INTO v_nova FROM nova;
        IF i = 1 THEN
            ASSERT (SELECT equipa_id FROM utilizadores WHERE id = v_c) = v_nova, 'a primeira equipa criada devia ser a da conta';
        ELSE
            ASSERT (SELECT equipa_id FROM utilizadores WHERE id = v_c) <> v_nova, 'a segunda equipa criada é uma adversária';
        END IF;
    END LOOP;
    ASSERT (SELECT nome FROM equipas WHERE id = (SELECT equipa_id FROM utilizadores WHERE id = v_c)) = 'Equipa 1',
        'a equipa da conta continua a ser a primeira';
END
$$;

ROLLBACK;
SELECT 'testes da equipa da conta: OK';
