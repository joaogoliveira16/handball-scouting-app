INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo)
VALUES (@equipaId, @numero, @nome, @posicao)
RETURNING id;
