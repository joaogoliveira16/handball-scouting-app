-- Todos os remates com coordenadas (para o mapa de remates do dashboard)
SELECT id, equipa_id, jogador_id, jogador_numero, x, y, resultado, situacao
FROM v_remates
WHERE jogo_id = @jogoId
ORDER BY id;
