-- Jogadores das duas equipas de um jogo, com a indicação de quem está convocado
SELECT j.id,
       j.equipa_id,
       j.numero,
       j.nome,
       j.posicao_codigo AS posicao,
       (c.jogador_id IS NOT NULL) AS convocado
FROM jogos g
JOIN jogadores j ON j.equipa_id IN (g.equipa_casa_id, g.equipa_fora_id)
LEFT JOIN convocados c ON c.jogo_id = g.id AND c.jogador_id = j.id
WHERE g.id = @jogoId
ORDER BY j.equipa_id, j.numero;
