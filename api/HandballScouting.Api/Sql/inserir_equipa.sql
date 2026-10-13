-- Cria uma equipa da conta. Se a conta ainda não tem equipa, esta passa a ser a equipa da conta.
WITH nova AS (
    INSERT INTO equipas (nome, dono_id) VALUES (@nome, @donoId) RETURNING id
), atribuida AS (
    UPDATE utilizadores SET equipa_id = (SELECT id FROM nova) WHERE id = @donoId AND equipa_id IS NULL
)
SELECT id FROM nova;
