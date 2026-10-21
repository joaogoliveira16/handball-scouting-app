-- Todos os remates dos jogos da conta em que a equipa joga (os da equipa e os dos adversários), para o relatório
-- do próximo adversário. Cada remate traz o jogo, o corredor, a distância, a defesa que se jogava, o local na baliza
-- (quando foi marcado) e o guarda-redes que defendia, que são o que as contas do relatório usam.
-- Só contam jogos que já têm registos (como a lista de jogos da equipa).
SELECT r.jogo_id, r.equipa_id, r.jogador_id, r.jogador_numero, r.guarda_redes_id,
       r.resultado, r.situacao, r.corredor, r.distancia,
       r.baliza_x, r.baliza_y, r.baliza_zona, r.sistema_defensivo, r.parte
FROM v_remates r
JOIN jogos g ON g.id = r.jogo_id
WHERE g.dono_id = @donoId
  AND @equipaId IN (g.equipa_casa_id, g.equipa_fora_id)
ORDER BY r.jogo_id, r.id;
