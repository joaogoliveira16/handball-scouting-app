-- Parcial dos últimos N minutos de jogo (relativo ao evento mais recente)
WITH ultimo AS (
    SELECT COALESCE(MAX(segundo_jogo), 0) AS atual
    FROM eventos
    WHERE jogo_id = @jogoId
)
SELECT eq.id AS equipa_id,
       eq.nome,
       COUNT(r.id)                                    AS remates,
       COUNT(r.id) FILTER (WHERE r.resultado = 'GOLO') AS golos
FROM jogos g
CROSS JOIN ultimo
JOIN equipas eq ON eq.id IN (g.equipa_casa_id, g.equipa_fora_id)
LEFT JOIN v_remates r ON r.jogo_id = g.id
                     AND r.equipa_id = eq.id
                     AND r.segundo_jogo > ultimo.atual - (@minutos * 60)
WHERE g.id = @jogoId
GROUP BY eq.id, eq.nome, g.equipa_casa_id
ORDER BY (eq.id = g.equipa_casa_id) DESC;
