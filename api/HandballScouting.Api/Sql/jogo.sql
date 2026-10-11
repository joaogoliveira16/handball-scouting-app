-- Dados de um jogo
SELECT g.id,
       g.data_hora,
       g.local,
       c.id   AS casa_id,
       c.nome AS casa_nome,
       f.id   AS fora_id,
       f.nome AS fora_nome
FROM jogos g
JOIN equipas c ON c.id = g.equipa_casa_id
JOIN equipas f ON f.id = g.equipa_fora_id
WHERE g.id = @jogoId;
