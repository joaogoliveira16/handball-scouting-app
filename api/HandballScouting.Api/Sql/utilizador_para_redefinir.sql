-- A conta com este email (confirmada ou não), para lhe enviar o link de recuperação da palavra-passe.
-- Uma conta desativada não recebe o link (também não entraria).
SELECT id, nome, email FROM utilizadores WHERE email = @email AND desativado_em IS NULL;
