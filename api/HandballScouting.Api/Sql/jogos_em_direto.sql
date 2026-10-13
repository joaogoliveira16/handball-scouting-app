-- Jogos abertos a convidados: os que o dono não escondeu e cujo último evento (ou, sem eventos, a data do jogo)
-- está dentro da janela. Mostra o resultado, mas não o código do link de partilha.
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
WHERE jogo_aberto_a_convidados(g.id, @minutos)
GROUP BY g.id, c.nome, f.nome, u.ultimo_evento
ORDER BY u.ultimo_evento DESC NULLS LAST, g.data_hora, g.id DESC
LIMIT 50;
