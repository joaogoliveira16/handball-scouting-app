-- Jogos de uma equipa da conta que já têm registos (do mais antigo para o mais recente), com o adversário e o resultado.
-- Um jogo sem nenhum evento ainda não conta: é um jogo marcado, não jogado.
-- Com o parâmetro parte (1 ou 2) só contam os jogos com eventos nessa parte, e os golos são os dessa parte; sem ela (null), o jogo todo.
SELECT g.id              AS jogo_id,
       g.data_hora,
       adv.id            AS adversario_id,
       adv.nome          AS adversario_nome,
       (g.equipa_casa_id = @equipaId) AS em_casa,
       COUNT(r.id) FILTER (WHERE r.resultado = 'GOLO' AND r.equipa_id = @equipaId)  AS golos,
       COUNT(r.id) FILTER (WHERE r.resultado = 'GOLO' AND r.equipa_id <> @equipaId) AS golos_adversario
FROM jogos g
JOIN equipas adv ON adv.id = CASE WHEN g.equipa_casa_id = @equipaId THEN g.equipa_fora_id ELSE g.equipa_casa_id END
LEFT JOIN v_remates r ON r.jogo_id = g.id AND (@parte::smallint IS NULL OR r.parte = @parte::smallint)
WHERE g.dono_id = @donoId
  AND @equipaId IN (g.equipa_casa_id, g.equipa_fora_id)
  AND EXISTS (SELECT 1 FROM eventos e WHERE e.jogo_id = g.id AND (@parte::smallint IS NULL OR e.parte = @parte::smallint))
GROUP BY g.id, adv.id
ORDER BY g.data_hora, g.id;
