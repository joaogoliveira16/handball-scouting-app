-- Plantel de uma equipa; "eventos" conta os eventos em que o jogador aparece (rematou ou defendeu)
SELECT j.id,
       j.equipa_id,
       j.numero,
       j.nome,
       j.posicao_codigo AS posicao,
       (SELECT COUNT(*) FROM eventos e
        WHERE e.jogador_id = j.id OR e.guarda_redes_id = j.id) AS eventos
FROM jogadores j
WHERE j.equipa_id = @equipaId
ORDER BY j.numero;
