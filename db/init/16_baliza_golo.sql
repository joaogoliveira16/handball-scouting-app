-- Onde entrou o golo: o local na baliza passa a poder existir também num golo (antes só numa defesa).
-- Fica guardado nas mesmas colunas (baliza_x, baliza_y e a zona 3 x 3 calculada pelo PostgreSQL); a vista v_remates já as traz.
-- Este ficheiro é idempotente: também serve para atualizar uma base de dados já existente:
--   Get-Content db/init/16_baliza_golo.sql -Raw | docker compose exec -T db psql -U scouting -d scouting   (PowerShell)
--   docker compose exec -T db psql -U scouting -d scouting < db/init/16_baliza_golo.sql                     (Linux, macOS)

-- Os dois pontos vêm juntos e só existem numa defesa ou num golo (a regra antiga só deixava numa defesa)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'baliza_coerente' AND conrelid = 'eventos'::regclass AND pg_get_constraintdef(oid) LIKE '%GOLO%'
    ) THEN
        ALTER TABLE eventos DROP CONSTRAINT IF EXISTS baliza_coerente;
        ALTER TABLE eventos ADD CONSTRAINT baliza_coerente CHECK (
            (baliza_x IS NULL) = (baliza_y IS NULL)
            AND (baliza_x IS NULL OR resultado IN ('DEFESA', 'GOLO'))
        );
    END IF;
END
$$;

-- Jogo de exemplo (2): põe o local nos golos fictícios, só se ainda não houver nenhum golo com local registado
WITH golos AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS n
    FROM eventos
    WHERE jogo_id = 2 AND resultado = 'GOLO' AND baliza_x IS NULL
),
pontos (n, bx, by) AS (
    VALUES (1, 14, 16), (2, 86, 20), (3, 50, 14), (4, 16, 84), (5, 84, 82), (6, 82, 50), (7, 20, 48), (8, 52, 86),
           (9, 50, 50), (10, 12, 24), (11, 88, 76), (12, 66, 18), (13, 30, 70), (14, 78, 34), (15, 40, 56)
)
UPDATE eventos e
SET baliza_x = p.bx, baliza_y = p.by
FROM golos g
JOIN pontos p ON p.n = ((g.n - 1) % 15) + 1
WHERE e.id = g.id
  AND NOT EXISTS (SELECT 1 FROM eventos WHERE resultado = 'GOLO' AND baliza_x IS NOT NULL);
