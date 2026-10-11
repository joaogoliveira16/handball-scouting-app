-- Jogadores das duas equipas de um jogo
SELECT j.id,
       j.equipa_id,
       j.numero,
       j.nome,
       j.posicao_codigo AS posicao
FROM jogos g
JOIN jogadores j ON j.equipa_id IN (g.equipa_casa_id, g.equipa_fora_id)
WHERE g.id = @jogoId
ORDER BY j.equipa_id, j.numero;
