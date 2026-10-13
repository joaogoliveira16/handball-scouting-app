-- Testes das sanções: 3.º "2 minutos" e vermelho direto desqualificam o jogador.
--   psql -v ON_ERROR_STOP=1 -f db/tests/expulsoes.sql
-- Corre dentro de uma transação que é desfeita no fim (não deixa dados).

BEGIN;

DO $$
DECLARE
    v_jogo INT;
    v_outro INT;
    v_a INT;   -- jogador da equipa 1
    v_b INT;   -- outro jogador da equipa 1
    v_c INT;   -- jogador da equipa 2
BEGIN
    -- O vermelho direto é um tipo de evento (sem posição no campo) e fica a seguir aos 2 minutos
    ASSERT (SELECT nome FROM tipos_evento WHERE codigo = 'VERMELHO') = 'Vermelho direto', 'devia existir o tipo VERMELHO';
    ASSERT NOT (SELECT e_remate FROM tipos_evento WHERE codigo = 'VERMELHO'), 'o vermelho não é um remate';
    ASSERT (SELECT ordem FROM tipos_evento WHERE codigo = 'VERMELHO') > (SELECT ordem FROM tipos_evento WHERE codigo = 'DOIS_MINUTOS'),
        'o vermelho devia vir a seguir aos 2 minutos';
    ASSERT (SELECT ordem FROM tipos_evento WHERE codigo = 'TIMEOUT') > (SELECT ordem FROM tipos_evento WHERE codigo = 'VERMELHO'),
        'o time-out devia vir depois do vermelho';

    INSERT INTO jogos (equipa_casa_id, equipa_fora_id) VALUES (1, 2) RETURNING id INTO v_jogo;
    SELECT id INTO v_a FROM jogadores WHERE equipa_id = 1 AND posicao_codigo <> 'GR' ORDER BY numero LIMIT 1;
    SELECT id INTO v_b FROM jogadores WHERE equipa_id = 1 AND posicao_codigo <> 'GR' AND id <> v_a ORDER BY numero LIMIT 1;
    SELECT id INTO v_c FROM jogadores WHERE equipa_id = 2 AND posicao_codigo <> 'GR' ORDER BY numero LIMIT 1;

    -- Sem sanções ninguém aparece
    ASSERT NOT EXISTS (SELECT 1 FROM v_sancoes WHERE jogo_id = v_jogo), 'num jogo limpo ninguém tem sanções';

    -- 1 e 2 vezes 2 minutos: cumpre a suspensão e volta, não é expulso
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, parte, segundo_jogo) VALUES (v_jogo, 1, 'DOIS_MINUTOS', v_a, 1, 300);
    ASSERT (SELECT dois_minutos FROM v_sancoes WHERE jogo_id = v_jogo AND jogador_id = v_a) = 1, 'devia contar um 2 minutos';
    ASSERT NOT (SELECT expulso FROM v_sancoes WHERE jogo_id = v_jogo AND jogador_id = v_a), 'com um 2 minutos não está expulso';
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, parte, segundo_jogo) VALUES (v_jogo, 1, 'DOIS_MINUTOS', v_a, 1, 900);
    ASSERT (SELECT dois_minutos FROM v_sancoes WHERE jogo_id = v_jogo AND jogador_id = v_a) = 2, 'devia contar dois 2 minutos';
    ASSERT NOT (SELECT expulso FROM v_sancoes WHERE jogo_id = v_jogo AND jogador_id = v_a), 'com dois 2 minutos ainda não está expulso';

    -- 2 minutos sem jogador não conta para ninguém
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, parte, segundo_jogo) VALUES (v_jogo, 1, 'DOIS_MINUTOS', 1, 950);
    ASSERT (SELECT COUNT(*) FROM v_sancoes WHERE jogo_id = v_jogo) = 1, 'um 2 minutos sem jogador não é de ninguém';

    -- 3.º 2 minutos: desqualificado
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, parte, segundo_jogo) VALUES (v_jogo, 1, 'DOIS_MINUTOS', v_a, 2, 2000);
    ASSERT (SELECT expulso FROM v_sancoes WHERE jogo_id = v_jogo AND jogador_id = v_a), 'ao 3.º 2 minutos o jogador está expulso';
    ASSERT (SELECT vermelhos FROM v_sancoes WHERE jogo_id = v_jogo AND jogador_id = v_a) = 0, 'não tem vermelhos';

    -- Vermelho direto: desqualificado logo, sem 2 minutos
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, parte, segundo_jogo) VALUES (v_jogo, 1, 'VERMELHO', v_b, 2, 2100);
    ASSERT (SELECT expulso FROM v_sancoes WHERE jogo_id = v_jogo AND jogador_id = v_b), 'o vermelho direto expulsa logo';
    ASSERT (SELECT vermelhos FROM v_sancoes WHERE jogo_id = v_jogo AND jogador_id = v_b) = 1, 'devia contar um vermelho';
    ASSERT (SELECT dois_minutos FROM v_sancoes WHERE jogo_id = v_jogo AND jogador_id = v_b) = 0, 'o vermelho não conta como 2 minutos';

    -- É por jogo e por jogador: o adversário e outros jogos não são afetados
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, parte, segundo_jogo) VALUES (v_jogo, 2, 'DOIS_MINUTOS', v_c, 1, 600);
    ASSERT NOT (SELECT expulso FROM v_sancoes WHERE jogo_id = v_jogo AND jogador_id = v_c), 'o adversário com um 2 minutos não está expulso';
    ASSERT (SELECT equipa_id FROM v_sancoes WHERE jogo_id = v_jogo AND jogador_id = v_c) = 2, 'a equipa vem do jogador';
    INSERT INTO jogos (equipa_casa_id, equipa_fora_id) VALUES (1, 2) RETURNING id INTO v_outro;
    ASSERT NOT EXISTS (SELECT 1 FROM v_sancoes WHERE jogo_id = v_outro), 'as sanções de um jogo não passam para outro jogo';

    -- Apagar o evento corrige o engano: o jogador volta a poder jogar
    DELETE FROM eventos WHERE jogo_id = v_jogo AND jogador_id = v_b AND tipo_evento_codigo = 'VERMELHO';
    ASSERT NOT EXISTS (SELECT 1 FROM v_sancoes WHERE jogo_id = v_jogo AND jogador_id = v_b), 'sem o vermelho o jogador já não tem sanções';

    -- Os remates que o jogador já fez continuam nas estatísticas depois de expulso
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, resultado, x, y, parte, segundo_jogo)
        VALUES (v_jogo, 1, 'REMATE', v_a, 'GOLO', 50, 40, 1, 100);
    ASSERT (SELECT COUNT(*) FROM v_remates WHERE jogo_id = v_jogo AND jogador_id = v_a) = 1, 'os remates do jogador expulso continuam a contar';
END
$$;

ROLLBACK;
SELECT 'testes das expulsões: OK';
