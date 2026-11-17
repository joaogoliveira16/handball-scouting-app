-- A conta com este id, para lhe enviar o link de recuperação da palavra-passe a pedido de um admin
SELECT id, nome, email FROM utilizadores WHERE id = @id AND desativado_em IS NULL;
