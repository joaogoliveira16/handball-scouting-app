-- A conta com este email (confirmada ou não), para lhe enviar o link de recuperação da palavra-passe
SELECT id, nome, email FROM utilizadores WHERE email = @email;
