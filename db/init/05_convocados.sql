-- Convocatória: jogadores convocados para cada jogo.
-- Este ficheiro é idempotente: também serve para atualizar uma base de dados já existente:
--   Get-Content db/init/05_convocados.sql -Raw | docker compose exec -T db psql -U scouting -d scouting   (PowerShell)
--   docker compose exec -T db psql -U scouting -d scouting < db/init/05_convocados.sql                     (Linux, macOS)
--
-- Um jogo sem convocados numa equipa significa "ainda sem convocatória": a app mostra
-- todos os jogadores dessa equipa. O máximo de convocados por equipa (16) é validado pela API.

CREATE TABLE IF NOT EXISTS convocados (
    jogo_id    INT NOT NULL REFERENCES jogos (id)     ON DELETE CASCADE,
    jogador_id INT NOT NULL REFERENCES jogadores (id) ON DELETE CASCADE,
    PRIMARY KEY (jogo_id, jogador_id)
);

CREATE INDEX IF NOT EXISTS ix_convocados_jogador ON convocados (jogador_id);

-- Jogos de exemplo (1 e 2): todos os jogadores das duas equipas convocados
INSERT INTO convocados (jogo_id, jogador_id)
SELECT g.id, j.id
FROM jogos g
JOIN jogadores j ON j.equipa_id IN (g.equipa_casa_id, g.equipa_fora_id)
WHERE g.id IN (1, 2)
ON CONFLICT DO NOTHING;
