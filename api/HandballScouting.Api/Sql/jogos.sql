-- Jogos de uma conta com o resultado (golos de cada equipa). "codigo" é o código do link de partilha e
-- "visivel_convidados" diz se o jogo pode aparecer na área de convidado quando está em direto.
SELECT g.id,
       g.codigo,
       g.data_hora,
       g.local,
       g.visivel_convidados,
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
WHERE g.dono_id = @donoId
GROUP BY g.id, c.id, f.id
ORDER BY g.data_hora DESC, g.id DESC;
