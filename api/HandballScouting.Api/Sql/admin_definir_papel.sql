-- Muda o papel de uma conta. Nunca deixa a app sem nenhum admin ativo (a conta que perde o papel não conta).
UPDATE utilizadores u
SET papel = @papel
WHERE u.id = @id
  AND u.papel <> @papel
  AND (@papel = 'admin' OR EXISTS (
        SELECT 1 FROM utilizadores o
        WHERE o.id <> u.id AND o.papel = 'admin' AND o.desativado_em IS NULL AND o.email_verificado_em IS NOT NULL))
RETURNING u.id;
