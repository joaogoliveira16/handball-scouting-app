-- Testes da convocatória. Correr com:
--   psql -v ON_ERROR_STOP=1 -f db/tests/convocados.sql
-- Corre dentro de uma transação que é desfeita no fim (não deixa dados).

BEGIN;

DO $$
DECLARE
    v_total INT;
    v_jogo  INT;
BEGIN
    -- Jogos de exemplo: 16 convocados (8 jogadores por equipa)
    SELECT COUNT(*) INTO v_total FROM convocados WHERE jogo_id = 2;
    ASSERT v_total = 16, format('jogo 2 devia ter 16 convocados, tem %s', v_total);

    -- Não pode convocar duas vezes o mesmo jogador
    BEGIN
        INSERT INTO convocados (jogo_id, jogador_id) VALUES (2, 1);
        ASSERT FALSE, 'a chave primária devia impedir a convocatória repetida';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    -- Apagar um jogo apaga a convocatória
    INSERT INTO jogos (equipa_casa_id, equipa_fora_id) VALUES (1, 2) RETURNING id INTO v_jogo;
    INSERT INTO convocados (jogo_id, jogador_id) VALUES (v_jogo, 3), (v_jogo, 4);
    DELETE FROM jogos WHERE id = v_jogo;
    SELECT COUNT(*) INTO v_total FROM convocados WHERE jogo_id = v_jogo;
    ASSERT v_total = 0, 'apagar o jogo devia apagar os convocados (ON DELETE CASCADE)';

    -- Um jogador com eventos não pode ser apagado (protege as estatísticas)
    BEGIN
        DELETE FROM jogadores WHERE id = 4;
        ASSERT FALSE, 'não devia ser possível apagar um jogador com eventos';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;

    -- Número de camisola único por equipa
    BEGIN
        INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo) VALUES (1, 9, 'Repetido', 'LE');
        ASSERT FALSE, 'o número devia ser único por equipa';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;
END
$$;

ROLLBACK;

SELECT 'testes de convocados: OK' AS resultado;
