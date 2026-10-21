-- Os eventos que não são remates (perdas de bola, exclusões, ...) de cada equipa nos jogos da conta em que a equipa
-- joga. Os avisos de início e fim do ataque 7x6 não contam.
SELECT e.jogo_id,
       e.equipa_id,
       e.tipo_evento_codigo AS tipo,
       COUNT(*) AS total
FROM eventos e
JOIN tipos_evento t ON t.codigo = e.tipo_evento_codigo AND NOT t.e_remate
JOIN jogos g ON g.id = e.jogo_id
WHERE g.dono_id = @donoId
  AND @equipaId IN (g.equipa_casa_id, g.equipa_fora_id)
  AND e.tipo_evento_codigo NOT IN ('SETE_SEIS_INICIO', 'SETE_SEIS_FIM')
GROUP BY e.jogo_id, e.equipa_id, e.tipo_evento_codigo
ORDER BY e.jogo_id, e.equipa_id, e.tipo_evento_codigo;
