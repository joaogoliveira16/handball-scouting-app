-- Depois de mudar de adversário: tira da convocatória os jogadores que já não são de nenhuma das duas equipas do jogo.
DELETE FROM convocados c
USING jogadores j
WHERE c.jogo_id = @jogoId
  AND j.id = c.jogador_id
  AND j.equipa_id NOT IN (@casaId, @foraId);
