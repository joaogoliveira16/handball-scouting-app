-- Só atualiza jogadores de equipas da conta
UPDATE jogadores
SET numero = @numero,
    nome = @nome,
    posicao_codigo = @posicao
WHERE id = @jogadorId
  AND equipa_id IN (SELECT id FROM equipas WHERE dono_id = @donoId);
