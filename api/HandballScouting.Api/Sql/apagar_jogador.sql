-- Só apaga jogadores de equipas da conta
DELETE FROM jogadores
WHERE id = @jogadorId
  AND equipa_id IN (SELECT id FROM equipas WHERE dono_id = @donoId);
