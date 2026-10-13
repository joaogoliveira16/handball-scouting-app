-- O tablet do banco diz em que segundo está o relógio e se está a andar (uma linha por jogo)
INSERT INTO relogios_jogo (jogo_id, segundo, a_correr, atualizado_em)
VALUES (@jogoId, @segundo, @aCorrer, clock_timestamp())
ON CONFLICT (jogo_id) DO UPDATE
SET segundo = EXCLUDED.segundo,
    a_correr = EXCLUDED.a_correr,
    atualizado_em = EXCLUDED.atualizado_em;
