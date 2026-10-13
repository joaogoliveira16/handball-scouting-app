-- Jogos que estão a ser registados agora e que o dono não escondeu da área de convidado:
-- o último evento tem poucos minutos (a API diz quantos). Mostra o resultado, mas não o código do link de partilha.
SELECT g.id,
       g.data_hora,
       g.local,
       c.nome AS casa_nome,
       f.nome AS fora_nome,
       u.ultimo_evento,
       COUNT(r.id) FILTER (WHERE r.resultado = 'GOLO' AND r.equipa_id = g.equipa_casa_id) AS golos_casa,
       COUNT(r.id) FILTER (WHERE r.resultado = 'GOLO' AND r.equipa_id = g.equipa_fora_id) AS golos_fora
FROM jogos g
JOIN equipas c ON c.id = g.equipa_casa_id
JOIN equipas f ON f.id = g.equipa_fora_id
CROSS JOIN LATERAL (SELECT MAX(e.criado_em) AS ultimo_evento FROM eventos e WHERE e.jogo_id = g.id) u
LEFT JOIN v_remates r ON r.jogo_id = g.id
WHERE g.visivel_convidados
  AND u.ultimo_evento > now() - make_interval(mins => @minutos)
GROUP BY g.id, c.nome, f.nome, u.ultimo_evento
ORDER BY u.ultimo_evento DESC, g.id DESC
LIMIT 50;
