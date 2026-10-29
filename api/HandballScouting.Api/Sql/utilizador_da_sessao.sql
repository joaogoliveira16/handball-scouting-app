-- A conta de uma sessão. Uma conta desativada deixa de ter sessão válida na hora (sem esperar que a sessão expire).
-- Aproveita para marcar o último acesso da conta, no máximo uma vez por hora (para não escrever em todos os pedidos).
WITH sessao AS (
    SELECT u.id, u.nome, u.email, (u.papel = 'admin') AS admin
    FROM sessoes s
    JOIN utilizadores u ON u.id = s.utilizador_id
    WHERE s.token_hash = @tokenHash AND s.expira_em > now() AND u.email_verificado_em IS NOT NULL AND u.desativado_em IS NULL
), acesso AS (
    UPDATE utilizadores u SET ultimo_acesso_em = now()
    WHERE u.id IN (SELECT id FROM sessao) AND (u.ultimo_acesso_em IS NULL OR u.ultimo_acesso_em < now() - interval '1 hour')
)
SELECT id, nome, email, admin FROM sessao;
