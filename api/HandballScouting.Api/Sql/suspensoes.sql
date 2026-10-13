-- Os 2 minutos e os vermelhos diretos do jogo: cada um deixa a equipa com menos um jogador durante 2 minutos
SELECT e.id AS evento_id,
       e.equipa_id,
       e.jogador_id,
       j.numero AS jogador_numero,
       e.tipo_evento_codigo AS tipo,
       e.segundo_jogo
FROM eventos e
LEFT JOIN jogadores j ON j.id = e.jogador_id
WHERE e.jogo_id = @jogoId
  AND e.tipo_evento_codigo IN ('DOIS_MINUTOS', 'VERMELHO')
ORDER BY e.segundo_jogo, e.id;
