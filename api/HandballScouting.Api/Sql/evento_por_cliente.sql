-- O evento que o tablet já tinha enviado com este identificador (para responder a um reenvio)
SELECT id
FROM eventos
WHERE jogo_id = @jogoId
  AND cliente_id = @clienteId;
