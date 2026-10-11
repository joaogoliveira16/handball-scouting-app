SELECT id, equipa_id, posicao_codigo
FROM jogadores
WHERE id = ANY(@ids);
