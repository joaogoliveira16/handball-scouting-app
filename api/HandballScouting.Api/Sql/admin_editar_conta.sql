-- Muda o nome e o email de uma conta que não é de admin. Se o email mudou, a conta volta a ficar por confirmar: perde as
-- sessões e os links que tinha (um link enviado para o email antigo não pode servir a quem já não é dono da conta).
-- Devolve uma linha {id, email_mudou}, ou nenhuma se a conta não existe ou é de admin.
-- Um email que já é de outra conta rebenta com a violação de unicidade (23505), que a API traduz para 409.
WITH antes AS (
    SELECT u.id, u.email FROM utilizadores u WHERE u.id = @id AND u.papel <> 'admin' FOR UPDATE
), depois AS (
    UPDATE utilizadores u
    SET nome = @nome,
        email = @email,
        email_verificado_em = CASE WHEN u.email = @email THEN u.email_verificado_em ELSE NULL END
    FROM antes
    WHERE u.id = antes.id
    RETURNING u.id, (antes.email <> @email) AS email_mudou
), sem_sessoes AS (
    DELETE FROM sessoes WHERE utilizador_id IN (SELECT id FROM depois WHERE email_mudou)
), sem_verificacoes AS (
    DELETE FROM verificacoes_email WHERE utilizador_id IN (SELECT id FROM depois WHERE email_mudou)
), sem_redefinicoes AS (
    DELETE FROM redefinicoes_palavra_passe WHERE utilizador_id IN (SELECT id FROM depois WHERE email_mudou)
)
SELECT id, email_mudou FROM depois;
