-- A equipa existe e é desta conta?
SELECT EXISTS (SELECT 1 FROM equipas WHERE id = @equipaId AND dono_id = @donoId);
