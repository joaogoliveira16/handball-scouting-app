-- Remates e eficácia por equipa e corredor (ponta, lateral, central)
SELECT r.equipa_id,
       r.corredor AS zona,
       COUNT(*)                                    AS remates,
       COUNT(*) FILTER (WHERE r.resultado = 'GOLO') AS golos,
       ROUND(100.0 * COUNT(*) FILTER (WHERE r.resultado = 'GOLO') / COUNT(*), 1) AS eficacia
FROM v_remates r
WHERE r.jogo_id = @jogoId
GROUP BY r.equipa_id, r.corredor
ORDER BY r.equipa_id, r.corredor;
