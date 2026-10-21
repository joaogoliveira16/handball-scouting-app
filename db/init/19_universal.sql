-- Posição «Universal» (joga em qualquer posição de campo): acrescenta-a às bases de dados já existentes
-- (as novas já nascem com ela, em 02_dados_base.sql). Idempotente: corre sozinho em cada arranque
-- (ver o serviço "migrar" do docker-compose).
INSERT INTO posicoes (codigo, nome) VALUES ('UN', 'Universal') ON CONFLICT (codigo) DO NOTHING;
