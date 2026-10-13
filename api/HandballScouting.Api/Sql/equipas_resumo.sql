-- Resumo de remates por equipa (inclui equipas sem remates)
SELECT eq.id   AS equipa_id,
       eq.nome,
       escudo_versao(eq.id) AS escudo,
       (eq.id = g.equipa_casa_id) AS e_casa,
       COUNT(r.id)                                         AS remates,
       COUNT(r.id) FILTER (WHERE r.resultado = 'GOLO')      AS golos,
       COUNT(r.id) FILTER (WHERE r.resultado = 'DEFESA')    AS defesas,
       COUNT(r.id) FILTER (WHERE r.resultado = 'FORA')      AS fora,
       COUNT(r.id) FILTER (WHERE r.resultado = 'POSTE')     AS poste,
       COUNT(r.id) FILTER (WHERE r.resultado = 'BLOQUEADO') AS bloqueados,
       ROUND(100.0 * COUNT(r.id) FILTER (WHERE r.resultado = 'GOLO') / NULLIF(COUNT(r.id), 0), 1) AS eficacia
FROM jogos g
JOIN equipas eq ON eq.id IN (g.equipa_casa_id, g.equipa_fora_id)
LEFT JOIN v_remates r ON r.jogo_id = g.id AND r.equipa_id = eq.id
WHERE g.id = @jogoId
GROUP BY eq.id, eq.nome, g.equipa_casa_id
ORDER BY e_casa DESC;
