-- O jogo existe e é desta conta?
SELECT EXISTS (SELECT 1 FROM jogos WHERE id = @jogoId AND dono_id = @donoId);
