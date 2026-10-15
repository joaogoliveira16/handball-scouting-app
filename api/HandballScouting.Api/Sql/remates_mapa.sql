-- Todos os remates com coordenadas (para o mapa de remates do dashboard).
-- As defesas e os golos trazem ainda o local na baliza (baliza_x, baliza_y e a zona 3 x 3), quando foi marcado, e os
-- remates em ataque posicional a defesa que o adversário jogava (sistema_defensivo), quando foi escolhida.
-- O segundo de jogo serve para saber em que situação numérica (igualdade, superioridade...) cada remate foi feito.
SELECT id, equipa_id, jogador_id, jogador_numero, x, y, resultado, situacao,
       baliza_x, baliza_y, baliza_zona, sistema_defensivo, segundo_jogo
FROM v_remates
WHERE jogo_id = @jogoId
ORDER BY id;
