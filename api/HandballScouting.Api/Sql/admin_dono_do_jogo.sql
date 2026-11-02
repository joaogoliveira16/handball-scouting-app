-- A conta dona de um jogo (para um admin editar os eventos como se fosse o dono) e o nome dela
SELECT g.dono_id, u.nome AS dono_nome
FROM jogos g
JOIN utilizadores u ON u.id = g.dono_id
WHERE g.id = @jogoId;
