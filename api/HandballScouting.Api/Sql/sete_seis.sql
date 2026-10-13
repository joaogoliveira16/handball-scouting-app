-- Quando cada equipa passou a atacar com sete jogadores de campo (sem guarda-redes) e quando voltou ao normal
SELECT id AS evento_id,
       equipa_id,
       tipo_evento_codigo AS tipo,
       segundo_jogo
FROM eventos
WHERE jogo_id = @jogoId
  AND tipo_evento_codigo IN ('SETE_SEIS_INICIO', 'SETE_SEIS_FIM')
ORDER BY segundo_jogo, id;
