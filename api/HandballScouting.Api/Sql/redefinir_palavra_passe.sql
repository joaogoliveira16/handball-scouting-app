-- Muda a palavra-passe a partir do SHA-256 do código do link; devolve a conta (nenhuma linha se o código não existe,
-- expirou ou já foi usado). Também confirma o email e termina as sessões da conta.
WITH r AS (SELECT redefinir_palavra_passe(@tokenHash, @hash) AS id)
SELECT u.id, u.nome, u.email FROM utilizadores u JOIN r ON r.id = u.id;
