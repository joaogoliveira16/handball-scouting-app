SELECT u.id, u.nome, u.email
FROM sessoes s
JOIN utilizadores u ON u.id = s.utilizador_id
WHERE s.token_hash = @tokenHash AND s.expira_em > now();
