-- Testes do modo sem rede: o tablet gera um identificador por evento (cliente_id) e a base de dados recusa a repetição.
--   psql -v ON_ERROR_STOP=1 -f db/tests/fila_offline.sql
-- Corre dentro de uma transação que é desfeita no fim (não deixa dados).

BEGIN;

DO $$
DECLARE
    v_jogo  INT;
    v_outro INT;
    v_id    BIGINT;
    v_id2   BIGINT;
    v_uuid  UUID := '8f0c8f9e-6b0d-4c8e-9f55-0a1b2c3d4e5f';
BEGIN
    INSERT INTO jogos (equipa_casa_id, equipa_fora_id) VALUES (1, 2) RETURNING id INTO v_jogo;
    INSERT INTO jogos (equipa_casa_id, equipa_fora_id) VALUES (1, 2) RETURNING id INTO v_outro;

    -- Os eventos que não vêm do banco (e os antigos) não têm identificador, e podem ser tantos quantos se quiser
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, parte, segundo_jogo) VALUES (v_jogo, 1, 'TIMEOUT', 1, 10);
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, parte, segundo_jogo) VALUES (v_jogo, 1, 'TIMEOUT', 1, 20);
    ASSERT (SELECT COUNT(*) FROM eventos WHERE jogo_id = v_jogo AND cliente_id IS NULL) = 2, 'eventos sem identificador repetem-se à vontade';

    -- Com identificador, o primeiro envio regista e devolve o id (como o inserir_evento.sql da API)
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, parte, segundo_jogo, cliente_id)
    VALUES (v_jogo, 1, 'TIMEOUT', 1, 30, v_uuid)
    ON CONFLICT (jogo_id, cliente_id) WHERE cliente_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_id;
    ASSERT v_id IS NOT NULL, 'o primeiro envio devia registar o evento';

    -- O reenvio não regista nada e não devolve linhas
    v_id2 := NULL;
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, parte, segundo_jogo, cliente_id)
    VALUES (v_jogo, 1, 'TIMEOUT', 1, 30, v_uuid)
    ON CONFLICT (jogo_id, cliente_id) WHERE cliente_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_id2;
    ASSERT v_id2 IS NULL, 'o reenvio não devia registar o evento outra vez';
    ASSERT (SELECT COUNT(*) FROM eventos WHERE jogo_id = v_jogo AND cliente_id = v_uuid) = 1, 'ficou um só evento com este identificador';

    -- O evento que já existia lê-se pelo identificador (evento_por_cliente.sql)
    ASSERT (SELECT id FROM eventos WHERE jogo_id = v_jogo AND cliente_id = v_uuid) = v_id, 'o identificador devia levar ao evento original';

    -- O identificador só vale dentro do jogo
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, parte, segundo_jogo, cliente_id)
    VALUES (v_outro, 1, 'TIMEOUT', 1, 30, v_uuid)
    ON CONFLICT (jogo_id, cliente_id) WHERE cliente_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_id2;
    ASSERT v_id2 IS NOT NULL AND v_id2 <> v_id, 'o mesmo identificador noutro jogo é outro evento';

    -- Fora do ON CONFLICT, a repetição é um erro da própria base de dados
    BEGIN
        INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, parte, segundo_jogo, cliente_id)
        VALUES (v_jogo, 2, 'TIMEOUT', 2, 1900, v_uuid);
        ASSERT FALSE, 'não pode haver dois eventos do mesmo jogo com o mesmo identificador';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;

    -- Apagar o evento (desfazer) liberta o identificador
    DELETE FROM eventos WHERE id = v_id;
    ASSERT NOT EXISTS (SELECT 1 FROM eventos WHERE jogo_id = v_jogo AND cliente_id = v_uuid), 'o evento devia ter sido apagado';

    -- A hora do evento pode vir do tablet (criado_em é preenchido pela API; sem ela vale "agora")
    INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, parte, segundo_jogo, criado_em)
    VALUES (v_jogo, 1, 'TIMEOUT', 1, 40, now() - interval '7 minutes') RETURNING id INTO v_id;
    ASSERT (SELECT criado_em FROM eventos WHERE id = v_id) < now() - interval '6 minutes', 'o evento devia levar a hora do tablet';
END
$$;

ROLLBACK;

\echo 'OK: fila_offline'
