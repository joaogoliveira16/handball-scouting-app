-- A conta com este email, se ainda não confirmou o email
SELECT id, nome, email FROM utilizadores WHERE email = @email AND email_verificado_em IS NULL;
