-- Confirma o email a partir do SHA-256 do código do link; devolve o id da conta (NULL se o código não existe ou expirou)
SELECT confirmar_email(@tokenHash);
