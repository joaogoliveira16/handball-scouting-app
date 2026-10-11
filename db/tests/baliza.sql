-- Testes do local da defesa na baliza. Correr com:
--   psql -v ON_ERROR_STOP=1 -f db/tests/baliza.sql
-- Corre dentro de uma transação que é desfeita no fim (não deixa dados).

BEGIN;

DO $$
DECLARE
    v_id     BIGINT;
    v_zona   TEXT;
    v_total  INT;
    v_zonas  INT;
BEGIN
    -- Zonas 3 x 3 (x: esquerda a direita de quem remata; y: trave a chão)
    ASSERT zona_baliza(10, 10)   = 'ALTO_ESQ',     'canto superior esquerdo';
    ASSERT zona_baliza(50, 10)   = 'ALTO_CENTRO',  'cima ao centro';
    ASSERT zona_baliza(90, 10)   = 'ALTO_DIR',     'canto superior direito';
    ASSERT zona_baliza(10, 50)   = 'MEIO_ESQ',     'meio à esquerda';
    ASSERT zona_baliza(50, 50)   = 'MEIO_CENTRO',  'centro da baliza';
    ASSERT zona_baliza(90, 50)   = 'MEIO_DIR',     'meio à direita';
    ASSERT zona_baliza(10, 90)   = 'BAIXO_ESQ',    'canto inferior esquerdo';
    ASSERT zona_baliza(50, 90)   = 'BAIXO_CENTRO', 'baixo ao centro';
    ASSERT zona_baliza(90, 90)   = 'BAIXO_DIR',    'canto inferior direito';
    ASSERT zona_baliza(0, 0)     = 'ALTO_ESQ',     'limite 0,0';
    ASSERT zona_baliza(100, 100) = 'BAIXO_DIR',    'limite 100,100';
    ASSERT zona_baliza(33.33, 33.33) = 'ALTO_ESQ', 'logo antes do 1.º terço';
    ASSERT zona_baliza(33.34, 33.34) = 'MEIO_CENTRO', 'logo depois do 1.º terço';
    ASSERT zona_baliza(NULL, NULL) IS NULL, 'sem ponto não há zona';

    -- Uma defesa com local: a coluna gerada acompanha o ponto
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, guarda_redes_id, resultado, x, y, parte, segundo_jogo, baliza_x, baliza_y)
    VALUES (1, 1, 'REMATE', 3, 9, 'DEFESA', 30, 50, 1, 100, 20, 80)
    RETURNING id, baliza_zona INTO v_id, v_zona;
    ASSERT v_zona = 'BAIXO_ESQ', format('zona devia ser BAIXO_ESQ, é %s', v_zona);

    -- Uma defesa sem local continua válida (o local é opcional)
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, guarda_redes_id, resultado, x, y, parte, segundo_jogo)
    VALUES (1, 1, 'REMATE', 3, 9, 'DEFESA', 30, 50, 1, 110);

    -- O local aparece na vista dos remates
    SELECT baliza_zona INTO v_zona FROM v_remates WHERE id = v_id;
    ASSERT v_zona = 'BAIXO_ESQ', 'a vista v_remates devia mostrar a zona da baliza';

    -- Só numa defesa
    BEGIN
        INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, resultado, x, y, parte, segundo_jogo, baliza_x, baliza_y)
        VALUES (1, 1, 'REMATE', 3, 'GOLO', 30, 50, 1, 120, 50, 50);
        ASSERT FALSE, 'um golo não devia aceitar local de defesa';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    -- Os dois pontos vêm juntos
    BEGIN
        INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, resultado, x, y, parte, segundo_jogo, baliza_x)
        VALUES (1, 1, 'REMATE', 3, 'DEFESA', 30, 50, 1, 130, 50);
        ASSERT FALSE, 'baliza_x sem baliza_y devia ser recusado';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    -- Dentro da baliza (0 a 100)
    BEGIN
        INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, resultado, x, y, parte, segundo_jogo, baliza_x, baliza_y)
        VALUES (1, 1, 'REMATE', 3, 'DEFESA', 30, 50, 1, 140, 101, 50);
        ASSERT FALSE, 'baliza_x acima de 100 devia ser recusado';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    -- Jogo de exemplo: as 11 defesas têm local e há defesas em várias zonas
    SELECT COUNT(*), COUNT(DISTINCT baliza_zona) INTO v_total, v_zonas
    FROM v_remates WHERE jogo_id = 2 AND resultado = 'DEFESA';
    ASSERT v_total = 11, format('o jogo 2 devia ter 11 defesas, tem %s', v_total);
    ASSERT (SELECT COUNT(*) FROM v_remates WHERE jogo_id = 2 AND resultado = 'DEFESA' AND baliza_zona IS NOT NULL) = 11,
        'todas as defesas do jogo 2 deviam ter local';
    ASSERT v_zonas >= 8, format('as defesas do jogo 2 deviam cobrir pelo menos 8 zonas, cobrem %s', v_zonas);
END
$$;

ROLLBACK;

SELECT 'testes da baliza: OK' AS resultado;
