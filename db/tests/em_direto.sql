-- Testes dos jogos na área de convidado: quando um jogo está aberto a toda a gente (24 horas).
--   psql -v ON_ERROR_STOP=1 -f db/tests/em_direto.sql
-- Corre dentro de uma transação que é desfeita no fim (não deixa dados).

BEGIN;

DO $$
DECLARE
    v_jogo INT;
BEGIN
    -- Um jogo novo aparece na área de convidado por omissão e, mesmo sem eventos, está aberto (conta a hora do jogo)
    INSERT INTO jogos (equipa_casa_id, equipa_fora_id) VALUES (1, 2) RETURNING id INTO v_jogo;
    ASSERT (SELECT visivel_convidados FROM jogos WHERE id = v_jogo), 'um jogo novo devia ficar visível para convidados';
    ASSERT jogo_aberto_a_convidados(v_jogo, 1440), 'um jogo que começa agora devia estar aberto, mesmo sem eventos';

    -- Sem eventos conta a data e hora do jogo, para trás e para a frente
    UPDATE jogos SET data_hora = now() - interval '23 hours' WHERE id = v_jogo;
    ASSERT jogo_aberto_a_convidados(v_jogo, 1440), 'um jogo de há 23 horas sem eventos ainda está aberto';
    UPDATE jogos SET data_hora = now() - interval '25 hours' WHERE id = v_jogo;
    ASSERT NOT jogo_aberto_a_convidados(v_jogo, 1440), 'um jogo de há 25 horas sem eventos já não está aberto';
    UPDATE jogos SET data_hora = now() + interval '3 hours' WHERE id = v_jogo;
    ASSERT jogo_aberto_a_convidados(v_jogo, 1440), 'um jogo que começa daqui a 3 horas já aparece';
    UPDATE jogos SET data_hora = now() + interval '2 days' WHERE id = v_jogo;
    ASSERT NOT jogo_aberto_a_convidados(v_jogo, 1440), 'um jogo marcado para daqui a 2 dias ainda não aparece';

    -- Com eventos conta o último evento (e não a hora do jogo)
    UPDATE jogos SET data_hora = now() - interval '5 days' WHERE id = v_jogo;
    ASSERT NOT jogo_aberto_a_convidados(v_jogo, 1440), 'um jogo de há 5 dias sem eventos está fechado';
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, parte, segundo_jogo) VALUES (v_jogo, 1, 'TIMEOUT', 1, 60);
    ASSERT jogo_aberto_a_convidados(v_jogo, 1440), 'com um evento agora o jogo está aberto, seja qual for a hora marcada';

    -- O dono pode escondê-lo
    UPDATE jogos SET visivel_convidados = FALSE WHERE id = v_jogo;
    ASSERT NOT jogo_aberto_a_convidados(v_jogo, 1440), 'um jogo escondido não devia estar aberto a convidados';
    UPDATE jogos SET visivel_convidados = TRUE WHERE id = v_jogo;
    ASSERT jogo_aberto_a_convidados(v_jogo, 1440), 'ao mostrá-lo outra vez volta a estar aberto';

    -- Passadas 24 horas deixa de estar (conta o último evento, não o primeiro)
    UPDATE eventos SET criado_em = now() - interval '23 hours' WHERE jogo_id = v_jogo;
    ASSERT jogo_aberto_a_convidados(v_jogo, 1440), 'com o último evento há 23 horas o jogo ainda está aberto';
    UPDATE eventos SET criado_em = now() - interval '25 hours' WHERE jogo_id = v_jogo;
    ASSERT NOT jogo_aberto_a_convidados(v_jogo, 1440), 'com o último evento há 25 horas o jogo já não está aberto';
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, parte, segundo_jogo, criado_em)
        VALUES (v_jogo, 2, 'PERDA_BOLA', 1, 2700, now() - interval '5 minutes');
    ASSERT jogo_aberto_a_convidados(v_jogo, 1440), 'um evento recente volta a abrir o jogo';

    -- Jogos que não existem
    ASSERT NOT jogo_aberto_a_convidados(-1, 1440), 'um jogo que não existe não está aberto';
    ASSERT NOT jogo_aberto_a_convidados(NULL, 1440), 'sem jogo não há resposta positiva';
END
$$;

ROLLBACK;
SELECT 'testes dos jogos em direto: OK';
