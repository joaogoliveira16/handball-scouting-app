INSERT INTO equipas (nome, dono_id) VALUES (@nome, @donoId) RETURNING id;
