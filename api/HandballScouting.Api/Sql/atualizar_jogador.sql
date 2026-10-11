UPDATE jogadores
SET numero = @numero,
    nome = @nome,
    posicao_codigo = @posicao
WHERE id = @jogadorId;
