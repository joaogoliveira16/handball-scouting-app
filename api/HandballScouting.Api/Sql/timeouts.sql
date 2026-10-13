-- Os time-outs pedidos no jogo (cada equipa tem direito a 3 por jogo, no máximo 2 por parte)
SELECT id AS evento_id,
       equipa_id,
       parte,
       segundo_jogo
FROM eventos
WHERE jogo_id = @jogoId
  AND tipo_evento_codigo = 'TIMEOUT'
ORDER BY id;
