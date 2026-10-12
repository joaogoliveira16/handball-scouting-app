-- Só apaga eventos de jogos da conta
DELETE FROM eventos e
USING jogos g
WHERE e.id = @eventoId
  AND e.jogo_id = @jogoId
  AND g.id = e.jogo_id
  AND g.dono_id = @donoId;
