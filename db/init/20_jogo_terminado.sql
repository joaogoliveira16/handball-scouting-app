-- Jogo terminado: o dono marca o fim do jogo (e pode reabri-lo se se enganou). Serve para o banco fechar o registo,
-- para a lista de jogos e o dashboard dizerem que já acabou. Idempotente: corre sozinho em cada arranque
-- (ver o serviço "migrar" do docker-compose).
ALTER TABLE jogos ADD COLUMN IF NOT EXISTS terminado_em TIMESTAMPTZ;
