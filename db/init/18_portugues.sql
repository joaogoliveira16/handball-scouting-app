-- Português de Portugal: acertos de texto em bases de dados já existentes (as novas já nascem assim).
-- Idempotente: corre sozinho em cada arranque (ver o serviço "migrar" do docker-compose).

-- Em Portugal esta posição do andebol chama-se «pivot» (no Brasil, «pivô»)
UPDATE posicoes SET nome = 'Pivot' WHERE codigo = 'PV' AND nome = 'Pivô';
