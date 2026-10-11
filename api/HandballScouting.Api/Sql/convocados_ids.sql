SELECT jogador_id
FROM convocados
WHERE jogo_id = @jogoId
ORDER BY jogador_id;
