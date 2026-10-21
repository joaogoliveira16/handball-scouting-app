-- Apaga um jogo da conta com tudo o que é dele (eventos, convocados e relógio saem em cascata).
DELETE FROM jogos
WHERE id = @jogoId AND dono_id = @donoId
RETURNING id;
