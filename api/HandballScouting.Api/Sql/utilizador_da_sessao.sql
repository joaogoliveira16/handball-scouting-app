-- A conta de uma sessão. Uma conta desativada deixa de ter sessão válida na hora (sem esperar que a sessão expire).
SELECT u.id, u.nome, u.email, (u.papel = 'admin') AS admin
FROM sessoes s
JOIN utilizadores u ON u.id = s.utilizador_id
WHERE s.token_hash = @tokenHash AND s.expira_em > now() AND u.email_verificado_em IS NOT NULL AND u.desativado_em IS NULL;
