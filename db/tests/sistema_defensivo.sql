-- Testes do sistema defensivo do adversário. Correr com:
--   psql -v ON_ERROR_STOP=1 -f db/tests/sistema_defensivo.sql
-- Corre dentro de uma transação que é desfeita no fim (não deixa dados).

BEGIN;

DO $$
DECLARE
    v_id      BIGINT;
    v_sistema TEXT;
    v_total   INT;
    v_s       TEXT;
BEGIN
    -- Os cinco sistemas são aceites num remate em ataque posicional e aparecem na vista
    FOREACH v_s IN ARRAY ARRAY['6_0', '5_1', '3_2_1', '4_2', 'INDIVIDUAL'] LOOP
        INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, resultado, situacao, x, y, parte, segundo_jogo, sistema_defensivo)
        VALUES (1, 1, 'REMATE', 3, 'FORA', 'POSICIONAL', 30, 50, 1, 100, v_s)
        RETURNING id INTO v_id;
        SELECT sistema_defensivo INTO v_sistema FROM v_remates WHERE id = v_id;
        ASSERT v_sistema = v_s, format('a vista devia mostrar o sistema %s, mostra %s', v_s, v_sistema);
    END LOOP;

    -- É opcional: sem sistema fica a NULL
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, resultado, x, y, parte, segundo_jogo)
    VALUES (1, 1, 'REMATE', 3, 'GOLO', 30, 50, 1, 110)
    RETURNING id INTO v_id;
    ASSERT (SELECT sistema_defensivo IS NULL FROM v_remates WHERE id = v_id), 'sem sistema escolhido o campo fica a NULL';

    -- Um sistema desconhecido é recusado
    BEGIN
        INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, resultado, x, y, parte, segundo_jogo, sistema_defensivo)
        VALUES (1, 1, 'REMATE', 3, 'FORA', 30, 50, 1, 120, '7_0');
        RAISE EXCEPTION 'devia recusar um sistema defensivo desconhecido';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- Só num ataque posicional: no contra-ataque e nos 7 metros não há defesa montada
    FOREACH v_s IN ARRAY ARRAY['CONTRA_ATAQUE', 'SETE_METROS'] LOOP
        BEGIN
            INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, resultado, situacao, x, y, parte, segundo_jogo, sistema_defensivo)
            VALUES (1, 1, 'REMATE', 3, 'FORA', v_s, 30, 50, 1, 130, '6_0');
            RAISE EXCEPTION 'devia recusar um sistema defensivo num remate de %', v_s;
        EXCEPTION WHEN check_violation THEN NULL;
        END;
    END LOOP;

    -- Só num remate (um evento sem resultado não tem sistema)
    BEGIN
        INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, parte, segundo_jogo, sistema_defensivo)
        VALUES (1, 1, 'PERDA_BOLA', 3, 1, 140, '6_0');
        RAISE EXCEPTION 'devia recusar um sistema defensivo num evento que não é remate';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- Jogo de exemplo (2): os remates posicionais (15 por equipa) trazem a defesa do adversário, 1 em cada 6 sem ela;
    -- o contra-ataque e o 7 metros ficam sem sistema
    SELECT count(*) INTO v_total FROM eventos
    WHERE jogo_id = 2 AND resultado IS NOT NULL AND situacao = 'POSICIONAL' AND sistema_defensivo IS NOT NULL;
    ASSERT v_total = 26, format('o jogo 2 devia ter 26 remates posicionais com defesa marcada, tem %s', v_total);
    SELECT count(*) INTO v_total FROM eventos WHERE jogo_id = 2 AND situacao <> 'POSICIONAL' AND sistema_defensivo IS NOT NULL;
    ASSERT v_total = 0, 'o contra-ataque e o 7 metros do jogo 2 não têm sistema';
END
$$;

ROLLBACK;

SELECT 'testes do sistema defensivo: OK' AS resultado;
