-- Lista de jogos com o resultado (golos de cada equipa)
SELECT g.id,
       g.data_hora,
       g.local,
       c.id   AS casa_id,
       c.nome AS casa_nome,
       f.id   AS fora_id,
       f.nome AS fora_nome,
       COUNT(r.id) FILTER (WHERE r.resultado = 'GOLO' AND r.equipa_id = g.equipa_casa_id) AS golos_casa,
       COUNT(r.id) FILTER (WHERE r.resultado = 'GOLO' AND r.equipa_id = g.equipa_fora_id) AS golos_fora
FROM jogos g
JOIN equipas c ON c.id = g.equipa_casa_id
JOIN equipas f ON f.id = g.equipa_fora_id
LEFT JOIN v_remates r ON r.jogo_id = g.id
GROUP BY g.id, c.id, f.id
ORDER BY g.data_hora DESC, g.id DESC;
