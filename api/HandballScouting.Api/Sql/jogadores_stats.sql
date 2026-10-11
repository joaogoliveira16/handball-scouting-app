-- Remates e eficácia por jogador de campo (só quem já rematou)
SELECT j.id        AS jogador_id,
       j.equipa_id,
       j.numero,
       j.nome,
       j.posicao_codigo AS posicao,
       COUNT(r.id)                                    AS remates,
       COUNT(r.id) FILTER (WHERE r.resultado = 'GOLO') AS golos,
       ROUND(100.0 * COUNT(r.id) FILTER (WHERE r.resultado = 'GOLO') / NULLIF(COUNT(r.id), 0), 1) AS eficacia
FROM jogos g
JOIN jogadores j ON j.equipa_id IN (g.equipa_casa_id, g.equipa_fora_id)
LEFT JOIN v_remates r ON r.jogador_id = j.id AND r.jogo_id = g.id
WHERE g.id = @jogoId
GROUP BY j.id, j.equipa_id, j.numero, j.nome, j.posicao_codigo
HAVING COUNT(r.id) > 0
ORDER BY j.equipa_id, COUNT(r.id) DESC, j.numero;
