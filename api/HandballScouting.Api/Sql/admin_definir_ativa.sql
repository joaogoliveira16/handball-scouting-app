-- Desativa (@ativa = false) ou volta a ativar (@ativa = true) uma conta. Devolve o id só se o estado mudou.
UPDATE utilizadores u
SET desativado_em = CASE WHEN @ativa THEN NULL ELSE now() END
WHERE u.id = @id
  AND (u.desativado_em IS NULL) <> @ativa
RETURNING u.id;
