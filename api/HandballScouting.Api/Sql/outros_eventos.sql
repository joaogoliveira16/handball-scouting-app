-- Contagem dos eventos que não são remates (faltas ofensivas, perdas de bola, ...)
SELECT e.equipa_id,
       e.tipo_evento_codigo AS tipo,
       t.nome,
       COUNT(*) AS total
FROM eventos e
JOIN tipos_evento t ON t.codigo = e.tipo_evento_codigo AND NOT t.e_remate
WHERE e.jogo_id = @jogoId
GROUP BY e.equipa_id, e.tipo_evento_codigo, t.nome, t.ordem
ORDER BY t.ordem, e.equipa_id;
