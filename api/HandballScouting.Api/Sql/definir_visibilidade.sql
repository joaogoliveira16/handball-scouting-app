-- O dono mostra ou esconde um jogo na área de convidado. Devolve o jogo (nada se não for desta conta).
UPDATE jogos SET visivel_convidados = @visivel
WHERE id = @jogoId AND dono_id = @donoId
RETURNING id;
