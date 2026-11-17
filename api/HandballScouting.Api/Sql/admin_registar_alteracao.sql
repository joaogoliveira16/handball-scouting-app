-- Acrescenta uma linha ao registo de alterações
INSERT INTO registo_alteracoes (autor_id, autor_nome, tipo, acao, detalhe, jogo_id)
VALUES (@autorId, @autorNome, @tipo, @acao, @detalhe, @jogoId);
