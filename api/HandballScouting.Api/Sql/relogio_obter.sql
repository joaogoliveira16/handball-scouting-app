-- O relógio do jogo agora: o segundo em que estava quando o tablet avisou, mais o tempo que passou desde então se
-- estava a andar. O tablet repete o aviso de 30 em 30 segundos; se deixar de avisar (fechou, sem rede) o relógio
-- "pára" ao fim de 3 minutos, para não ficar a contar para sempre.
SELECT FLOOR(segundo + CASE WHEN a_correr THEN LEAST(EXTRACT(EPOCH FROM clock_timestamp() - atualizado_em), 180) ELSE 0 END)::INT AS segundo,
       (a_correr AND clock_timestamp() - atualizado_em < INTERVAL '3 minutes') AS a_correr
FROM relogios_jogo
WHERE jogo_id = @jogoId;
