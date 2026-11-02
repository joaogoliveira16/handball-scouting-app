-- As últimas alterações feitas por admins (@tipo vazio = todas)
SELECT id, quando, autor_nome, tipo, acao, detalhe, jogo_id
FROM registo_alteracoes
WHERE @tipo::text IS NULL OR tipo = @tipo
ORDER BY quando DESC, id DESC
LIMIT @limite;
