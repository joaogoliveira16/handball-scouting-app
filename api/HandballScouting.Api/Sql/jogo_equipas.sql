-- Equipas de um jogo da conta (nada se o jogo não existir ou for de outra conta)
SELECT equipa_casa_id AS casa_id,
       equipa_fora_id AS fora_id
FROM jogos
WHERE id = @jogoId AND dono_id = @donoId;
