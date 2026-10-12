SELECT id, nome, email, palavra_passe_hash, (email_verificado_em IS NOT NULL) AS email_verificado
FROM utilizadores WHERE email = @email;
