-- Equipas de uma conta, com o número de jogadores. A primeira é a equipa da conta (propria); as outras são adversárias.
SELECT e.id,
       e.nome,
       COUNT(j.id) AS jogadores,
       (e.id = u.equipa_id) AS propria,
       escudo_versao(e.id) AS escudo
FROM equipas e
JOIN utilizadores u ON u.id = e.dono_id
LEFT JOIN jogadores j ON j.equipa_id = e.id
WHERE e.dono_id = @donoId
GROUP BY e.id, e.nome, u.equipa_id
ORDER BY propria DESC, e.nome;
