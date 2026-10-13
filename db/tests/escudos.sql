-- Testes dos escudos das equipas: versão do escudo, troca, limites e o que acontece quando a equipa desaparece.
--   psql -v ON_ERROR_STOP=1 -f db/tests/escudos.sql
-- Corre dentro de uma transação que é desfeita no fim (não deixa dados).

BEGIN;

DO $$
DECLARE
    v_equipa INT;
    v_equipa2 INT;
    v_jogo INT;
    v1 BIGINT;
    v2 BIGINT;
    v_png BYTEA := '\x89504e470d0a1a0a0000000d49484452'::bytea;   -- o início de um PNG chega para a base de dados
BEGIN
    INSERT INTO equipas (nome) VALUES ('Equipa com escudo') RETURNING id INTO v_equipa;
    INSERT INTO equipas (nome) VALUES ('Equipa sem escudo') RETURNING id INTO v_equipa2;
    INSERT INTO jogos (equipa_casa_id, equipa_fora_id) VALUES (v_equipa, v_equipa2) RETURNING id INTO v_jogo;

    -- Sem escudo a versão é NULL
    ASSERT escudo_versao(v_equipa) IS NULL, 'uma equipa nova não tem escudo';
    ASSERT escudo_versao(-1) IS NULL, 'uma equipa que não existe não tem escudo';

    -- Com escudo há versão (milissegundos) e ela chega às listas de jogos
    INSERT INTO escudos (equipa_id, tipo, dados) VALUES (v_equipa, 'image/png', v_png);
    v1 := escudo_versao(v_equipa);
    ASSERT v1 > 1700000000000, 'a versão são os milissegundos da última alteração';
    ASSERT escudo_versao(v_equipa2) IS NULL, 'o escudo é só da equipa a que pertence';

    -- Trocar o escudo (é o que a API faz) muda a versão e mantém uma única linha
    PERFORM pg_sleep(0.02);
    INSERT INTO escudos (equipa_id, tipo, dados) VALUES (v_equipa, 'image/jpeg', '\xffd8ffe0'::bytea)
        ON CONFLICT (equipa_id) DO UPDATE SET tipo = EXCLUDED.tipo, dados = EXCLUDED.dados, atualizado_em = clock_timestamp();
    v2 := escudo_versao(v_equipa);
    ASSERT v2 > v1, 'ao trocar o escudo a versão tem de ser outra (para o browser ir buscar a imagem nova)';
    ASSERT (SELECT COUNT(*) FROM escudos WHERE equipa_id = v_equipa) = 1, 'cada equipa tem no máximo um escudo';
    ASSERT (SELECT tipo FROM escudos WHERE equipa_id = v_equipa) = 'image/jpeg', 'o escudo novo substituiu o antigo';

    -- Limites: só PNG, JPEG e WebP, e no máximo 200 KB
    BEGIN
        INSERT INTO escudos (equipa_id, tipo, dados) VALUES (v_equipa2, 'image/svg+xml', v_png);
        ASSERT FALSE, 'um SVG não devia ser aceite';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO escudos (equipa_id, tipo, dados) VALUES (v_equipa2, 'image/png', ''::bytea);
        ASSERT FALSE, 'uma imagem vazia não devia ser aceite';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO escudos (equipa_id, tipo, dados) VALUES (v_equipa2, 'image/png', decode(repeat('00', 204801), 'hex'));
        ASSERT FALSE, 'mais de 200 KB não devia ser aceite';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    INSERT INTO escudos (equipa_id, tipo, dados) VALUES (v_equipa2, 'image/webp', decode(repeat('00', 204800), 'hex'));
    ASSERT escudo_versao(v_equipa2) IS NOT NULL, 'exatamente 200 KB cabe';
    DELETE FROM escudos WHERE equipa_id = v_equipa2;
    ASSERT escudo_versao(v_equipa2) IS NULL, 'tirar o escudo deixa a equipa sem versão';

    -- O escudo desaparece com a equipa
    DELETE FROM jogos WHERE id = v_jogo;
    DELETE FROM equipas WHERE id = v_equipa;
    ASSERT NOT EXISTS (SELECT 1 FROM escudos WHERE equipa_id = v_equipa), 'apagar a equipa apaga o escudo';
END
$$;

ROLLBACK;
SELECT 'testes dos escudos: OK';
