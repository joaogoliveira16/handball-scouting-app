-- Testes da superioridade numérica: tipos do 7×6 e relógio do jogo guardado no servidor.
--   psql -v ON_ERROR_STOP=1 -f db/tests/superioridade.sql
-- Corre dentro de uma transação que é desfeita no fim (não deixa dados).
-- (A conta dos 2 minutos, do vermelho e do 7×6 está em api/HandballScouting.Api/Numerica.cs, com testes xUnit.)

BEGIN;

DO $$
DECLARE
    v_jogo INT;
    v_apagado INT;
BEGIN
    -- O 7×6 são dois tipos que não são remates e vêm depois de todos os outros
    ASSERT (SELECT nome FROM tipos_evento WHERE codigo = 'SETE_SEIS_INICIO') = 'Ataque 7×6 (início)', 'devia existir o tipo SETE_SEIS_INICIO';
    ASSERT (SELECT nome FROM tipos_evento WHERE codigo = 'SETE_SEIS_FIM') = 'Ataque 7×6 (fim)', 'devia existir o tipo SETE_SEIS_FIM';
    ASSERT NOT EXISTS (SELECT 1 FROM tipos_evento WHERE codigo LIKE 'SETE_SEIS%' AND e_remate), 'o 7×6 não é um remate';
    ASSERT (SELECT ordem FROM tipos_evento WHERE codigo = 'SETE_SEIS_FIM') > (SELECT ordem FROM tipos_evento WHERE codigo = 'SETE_SEIS_INICIO'),
        'o fim vem depois do início';
    ASSERT (SELECT MIN(ordem) FROM tipos_evento WHERE codigo LIKE 'SETE_SEIS%') > (SELECT ordem FROM tipos_evento WHERE codigo = 'TIMEOUT'),
        'o 7×6 devia vir depois dos tipos que já existiam';

    INSERT INTO jogos (equipa_casa_id, equipa_fora_id) VALUES (1, 2) RETURNING id INTO v_jogo;

    -- O 7×6 regista-se como qualquer evento: da equipa, sem jogador, sem coordenadas
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, parte, segundo_jogo) VALUES (v_jogo, 1, 'SETE_SEIS_INICIO', 1, 900);
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, parte, segundo_jogo) VALUES (v_jogo, 1, 'SETE_SEIS_FIM', 1, 960);

    -- Sem relógio guardado não há linha
    ASSERT NOT EXISTS (SELECT 1 FROM relogios_jogo WHERE jogo_id = v_jogo), 'um jogo novo não tem relógio guardado';

    -- O servidor guarda o segundo e se o relógio anda
    INSERT INTO relogios_jogo (jogo_id, segundo, a_correr) VALUES (v_jogo, 600, TRUE);
    ASSERT (SELECT a_correr FROM relogios_jogo WHERE jogo_id = v_jogo), 'o relógio devia estar a andar';

    -- Só há uma linha por jogo e o limite é 2 horas
    BEGIN
        INSERT INTO relogios_jogo (jogo_id, segundo, a_correr) VALUES (v_jogo, 700, FALSE);
        ASSERT FALSE, 'não pode haver dois relógios para o mesmo jogo';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    BEGIN
        UPDATE relogios_jogo SET segundo = 7201 WHERE jogo_id = v_jogo;
        ASSERT FALSE, 'o relógio não passa das 2 horas';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        UPDATE relogios_jogo SET segundo = -1 WHERE jogo_id = v_jogo;
        ASSERT FALSE, 'o relógio não é negativo';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- Apagar o jogo apaga o relógio
    INSERT INTO jogos (equipa_casa_id, equipa_fora_id) VALUES (1, 2) RETURNING id INTO v_apagado;
    INSERT INTO relogios_jogo (jogo_id, segundo, a_correr) VALUES (v_apagado, 10, FALSE);
    DELETE FROM jogos WHERE id = v_apagado;
    ASSERT NOT EXISTS (SELECT 1 FROM relogios_jogo WHERE jogo_id = v_apagado), 'o relógio devia desaparecer com o jogo';
END
$$;

ROLLBACK;

-- O script é idempotente: voltar a corrê-lo (é o que o serviço "migrar" faz em cada arranque) não duplica os tipos
\i db/init/14_superioridade.sql
\i db/init/14_superioridade.sql
DO $$
BEGIN
    ASSERT (SELECT COUNT(*) FROM tipos_evento WHERE codigo LIKE 'SETE_SEIS%') = 2, 'repetir o script não duplica os tipos do 7×6';
END
$$;
