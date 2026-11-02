-- Elimina uma conta (que não seja de admin) e tudo o que é dela. Devolve o que saiu, ou nada se a conta não existe ou é de admin.
SELECT equipas_eliminadas, jogadores_eliminados, jogos_eliminados FROM eliminar_conta(@id);
