-- Equipas de uma conta, com o número de jogadores
SELECT e.id,
       e.nome,
       COUNT(j.id) AS jogadores
FROM equipas e
LEFT JOIN jogadores j ON j.equipa_id = e.id
WHERE e.dono_id = @donoId
GROUP BY e.id, e.nome
ORDER BY e.nome;
