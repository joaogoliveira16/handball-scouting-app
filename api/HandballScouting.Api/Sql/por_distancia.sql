-- Remates e eficácia por equipa e faixa de distância à baliza
SELECT r.equipa_id,
       r.distancia AS zona,
       COUNT(*)                                    AS remates,
       COUNT(*) FILTER (WHERE r.resultado = 'GOLO') AS golos,
       ROUND(100.0 * COUNT(*) FILTER (WHERE r.resultado = 'GOLO') / COUNT(*), 1) AS eficacia
FROM v_remates r
WHERE r.jogo_id = @jogoId
GROUP BY r.equipa_id, r.distancia
ORDER BY r.equipa_id, r.distancia;
