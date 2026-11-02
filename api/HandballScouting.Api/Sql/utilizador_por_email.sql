SELECT id, nome, email, palavra_passe_hash, (email_verificado_em IS NOT NULL) AS email_verificado,
       (desativado_em IS NOT NULL) AS desativado, (papel = 'admin') AS admin
FROM utilizadores WHERE email = @email;
