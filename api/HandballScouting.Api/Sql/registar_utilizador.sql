-- Cria a conta (a primeira de todas adota os dados sem dono); devolve o id
SELECT registar_utilizador(@email, @nome, @hash);
