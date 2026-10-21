-- O dono marca o jogo como terminado (guarda quando) ou volta a abri-lo. Devolve o jogo (nada se não for desta conta).
UPDATE jogos
SET terminado_em = CASE WHEN @terminado THEN COALESCE(terminado_em, now()) ELSE NULL END
WHERE id = @jogoId AND dono_id = @donoId
RETURNING id;
