-- Dá o papel de admin às contas confirmadas cujo email está na configuração (Administracao__Emails)
UPDATE utilizadores
SET papel = 'admin'
WHERE email = ANY(@emails) AND papel <> 'admin' AND email_verificado_em IS NOT NULL AND desativado_em IS NULL
RETURNING email;
