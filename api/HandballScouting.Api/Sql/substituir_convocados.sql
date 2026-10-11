-- Substitui a convocatória do jogo. As duas instruções correm juntas, na mesma transação implícita.
DELETE FROM convocados WHERE jogo_id = @jogoId;
INSERT INTO convocados (jogo_id, jogador_id)
SELECT @jogoId, j.id
FROM jogadores j
WHERE j.id IN @ids;
