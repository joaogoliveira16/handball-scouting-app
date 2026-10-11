-- Todos os remates com coordenadas (para o mapa de remates do dashboard).
-- As defesas trazem ainda o local na baliza (baliza_x, baliza_y e a zona 3 x 3).
SELECT id, equipa_id, jogador_id, jogador_numero, x, y, resultado, situacao,
       baliza_x, baliza_y, baliza_zona
FROM v_remates
WHERE jogo_id = @jogoId
ORDER BY id;
