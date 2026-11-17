-- Índices para as consultas mais pedidas. Idempotente: corre sozinho em cada arranque
-- (ver o serviço "migrar" do docker-compose).

-- Área de convidado (jogos-em-direto, de 15 em 15 segundos): encontra os jogos com eventos recentes, ou marcados
-- para perto de agora, sem passar por todos os jogos da base de dados.
CREATE INDEX IF NOT EXISTS ix_eventos_criado ON eventos (criado_em);
CREATE INDEX IF NOT EXISTS ix_jogos_data     ON jogos (data_hora);

-- Estatísticas da equipa e relatório do adversário: os números de cada jogador em cada jogo
-- (remates do jogador e remates contra o guarda-redes, por jogo). Substituem os índices só pelo jogador.
CREATE INDEX IF NOT EXISTS ix_eventos_jogador_jogo ON eventos (jogador_id, jogo_id);
CREATE INDEX IF NOT EXISTS ix_eventos_gr_jogo      ON eventos (guarda_redes_id, jogo_id);
DROP INDEX IF EXISTS ix_eventos_jogador;
DROP INDEX IF EXISTS ix_eventos_gr;
