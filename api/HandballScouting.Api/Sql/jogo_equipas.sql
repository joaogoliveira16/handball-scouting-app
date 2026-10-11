SELECT equipa_casa_id AS casa_id,
       equipa_fora_id AS fora_id
FROM jogos
WHERE id = @jogoId;
