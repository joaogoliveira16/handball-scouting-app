-- O mesmo que outros_eventos.sql (faltas ofensivas, perdas de bola, 2 minutos, vermelhos, time-outs...), mas por parte.
-- Serve ao relatório do intervalo, que só conta a 1.ª parte. Os avisos do ataque 7×6 também não entram.
SELECT e.equipa_id,
       e.tipo_evento_codigo AS tipo,
       e.parte,
       COUNT(*) AS total
FROM eventos e
JOIN tipos_evento t ON t.codigo = e.tipo_evento_codigo AND NOT t.e_remate
WHERE e.jogo_id = @jogoId
  AND e.tipo_evento_codigo NOT IN ('SETE_SEIS_INICIO', 'SETE_SEIS_FIM')
GROUP BY e.equipa_id, e.tipo_evento_codigo, e.parte
ORDER BY e.parte, e.equipa_id, e.tipo_evento_codigo;
