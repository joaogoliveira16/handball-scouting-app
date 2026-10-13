-- Cria a conta e a sua equipa (a primeira conta confirmada adota os dados sem dono); devolve o id
SELECT registar_utilizador(@email, @nome, @hash, @equipa);
