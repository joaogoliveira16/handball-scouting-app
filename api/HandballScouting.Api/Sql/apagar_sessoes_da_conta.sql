-- Termina todas as sessões de uma conta (em todos os dispositivos)
DELETE FROM sessoes WHERE utilizador_id = @utilizadorId;
