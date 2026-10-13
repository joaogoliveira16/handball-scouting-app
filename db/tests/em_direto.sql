-- Testes dos jogos em direto na área de convidado: quando um jogo está aberto a toda a gente.
--   psql -v ON_ERROR_STOP=1 -f db/tests/em_direto.sql
-- Corre dentro de uma transação que é desfeita no fim (não deixa dados).

BEGIN;

DO $$
DECLARE
    v_jogo INT;
BEGIN
    -- Um jogo novo aparece na área de convidado por omissão, mas sem eventos ainda não está em direto
    INSERT INTO jogos (equipa_casa_id, equipa_fora_id) VALUES (1, 2) RETURNING id INTO v_jogo;
    ASSERT (SELECT visivel_convidados FROM jogos WHERE id = v_jogo), 'um jogo novo devia ficar visível para convidados';
    ASSERT NOT jogo_aberto_a_convidados(v_jogo, 30), 'sem eventos o jogo não está em direto';

    -- Com um evento agora, está
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, parte, segundo_jogo) VALUES (v_jogo, 1, 'TIMEOUT', 1, 60);
    ASSERT jogo_aberto_a_convidados(v_jogo, 30), 'com um evento agora o jogo devia estar em direto';

    -- O dono pode escondê-lo
    UPDATE jogos SET visivel_convidados = FALSE WHERE id = v_jogo;
    ASSERT NOT jogo_aberto_a_convidados(v_jogo, 30), 'um jogo escondido não devia estar aberto a convidados';
    UPDATE jogos SET visivel_convidados = TRUE WHERE id = v_jogo;
    ASSERT jogo_aberto_a_convidados(v_jogo, 30), 'ao mostrá-lo outra vez volta a estar aberto';

    -- Passado o tempo, deixa de estar (conta o último evento, não o primeiro)
    UPDATE eventos SET criado_em = now() - interval '45 minutes' WHERE jogo_id = v_jogo;
    ASSERT NOT jogo_aberto_a_convidados(v_jogo, 30), 'com o último evento há 45 minutos o jogo já não está em direto (30)';
    ASSERT jogo_aberto_a_convidados(v_jogo, 180), 'mas continua aberto na janela das 3 horas';
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, parte, segundo_jogo, criado_em)
        VALUES (v_jogo, 2, 'PERDA_BOLA', 1, 2700, now() - interval '5 minutes');
    ASSERT jogo_aberto_a_convidados(v_jogo, 30), 'um evento recente volta a pôr o jogo em direto';
    UPDATE eventos SET criado_em = now() - interval '4 hours' WHERE jogo_id = v_jogo;
    ASSERT NOT jogo_aberto_a_convidados(v_jogo, 180), 'passadas 4 horas o jogo já não está aberto';

    -- Jogos que não existem
    ASSERT NOT jogo_aberto_a_convidados(-1, 180), 'um jogo que não existe não está aberto';
    ASSERT NOT jogo_aberto_a_convidados(NULL, 180), 'sem jogo não há resposta positiva';
END
$$;

ROLLBACK;
SELECT 'testes dos jogos em direto: OK';
