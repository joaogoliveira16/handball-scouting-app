-- As contas para a página de administração (Utilizadores); com @id só essa conta. «estado»: ativo, por_confirmar ou
-- desativado. «equipa» é a equipa da conta; «jogos» conta os jogos que a conta criou; «ultimo_acesso_em» é a última vez
-- que a conta usou a app (NULL = ainda não).
SELECT u.id,
       u.nome,
       u.email,
       u.papel,
       u.criado_em,
       u.ultimo_acesso_em,
       CASE WHEN u.desativado_em IS NOT NULL THEN 'desativado'
            WHEN u.email_verificado_em IS NULL THEN 'por_confirmar'
            ELSE 'ativo' END AS estado,
       e.nome AS equipa,
       (SELECT COUNT(*) FROM jogos g WHERE g.dono_id = u.id) AS jogos
FROM utilizadores u
LEFT JOIN equipas e ON e.id = u.equipa_id
WHERE @id::int IS NULL OR u.id = @id
ORDER BY lower(u.nome), u.id;
