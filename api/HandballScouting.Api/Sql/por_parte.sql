-- Remates e golos por equipa e parte do jogo
SELECT r.equipa_id,
       r.parte,
       COUNT(*)                                    AS remates,
       COUNT(*) FILTER (WHERE r.resultado = 'GOLO') AS golos,
       ROUND(100.0 * COUNT(*) FILTER (WHERE r.resultado = 'GOLO') / COUNT(*), 1) AS eficacia
FROM v_remates r
WHERE r.jogo_id = @jogoId
GROUP BY r.equipa_id, r.parte
ORDER BY r.equipa_id, r.parte;
