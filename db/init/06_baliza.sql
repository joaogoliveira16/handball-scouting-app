-- Onde o guarda-redes defendeu: ponto na baliza (só nos remates com resultado DEFESA).
-- Este ficheiro é idempotente: também serve para atualizar uma base de dados já existente:
--   Get-Content db/init/06_baliza.sql -Raw | docker compose exec -T db psql -U scouting -d scouting   (PowerShell)
--   docker compose exec -T db psql -U scouting -d scouting < db/init/06_baliza.sql                     (Linux, macOS)
--
-- Coordenadas da baliza em percentagem (0 a 100), vistas de frente por quem remata:
--   baliza_x: 0 = poste esquerdo de quem remata, 100 = poste direito
--   baliza_y: 0 = trave (em cima), 100 = chão
-- A baliza tem 3 m x 2 m e divide-se em 3 x 3 zonas (baliza_zona, calculada pelo PostgreSQL).

-- Zona da baliza: ALTO | MEIO | BAIXO  +  ESQ | CENTRO | DIR  (ex.: ALTO_ESQ)
CREATE OR REPLACE FUNCTION zona_baliza(gx NUMERIC, gy NUMERIC) RETURNS VARCHAR
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT (CASE WHEN gy < 100.0 / 3 THEN 'ALTO' WHEN gy < 200.0 / 3 THEN 'MEIO' ELSE 'BAIXO' END)
        || '_' ||
           (CASE WHEN gx < 100.0 / 3 THEN 'ESQ' WHEN gx < 200.0 / 3 THEN 'CENTRO' ELSE 'DIR' END)
$$;

ALTER TABLE eventos ADD COLUMN IF NOT EXISTS baliza_x NUMERIC(5, 2) CHECK (baliza_x BETWEEN 0 AND 100);
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS baliza_y NUMERIC(5, 2) CHECK (baliza_y BETWEEN 0 AND 100);
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS baliza_zona VARCHAR(14)
    GENERATED ALWAYS AS (zona_baliza(baliza_x, baliza_y)) STORED;

-- Os dois pontos vêm juntos e só existem numa defesa
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'baliza_coerente' AND conrelid = 'eventos'::regclass) THEN
        ALTER TABLE eventos ADD CONSTRAINT baliza_coerente CHECK (
            (baliza_x IS NULL) = (baliza_y IS NULL)
            AND (baliza_x IS NULL OR resultado = 'DEFESA')
        );
    END IF;
END
$$;

-- A vista passa a incluir o local da defesa (as colunas novas ficam no fim)
CREATE OR REPLACE VIEW v_remates AS
SELECT e.id,
       e.jogo_id,
       e.equipa_id,
       e.jogador_id,
       e.guarda_redes_id,
       e.resultado,
       e.situacao,
       e.x,
       e.y,
       e.corredor,
       e.distancia,
       e.parte,
       e.segundo_jogo,
       e.criado_em,
       j.numero         AS jogador_numero,
       j.nome           AS jogador_nome,
       j.posicao_codigo AS posicao_jogador,
       e.baliza_x,
       e.baliza_y,
       e.baliza_zona
FROM eventos e
JOIN tipos_evento t ON t.codigo = e.tipo_evento_codigo AND t.e_remate
JOIN jogadores    j ON j.id = e.jogador_id
WHERE e.resultado IS NOT NULL;

-- Jogo de exemplo (2): põe o local nas defesas fictícias, só se ainda não houver nenhum local registado
WITH defesas AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS n
    FROM eventos
    WHERE jogo_id = 2 AND resultado = 'DEFESA' AND baliza_x IS NULL
),
pontos (n, bx, by) AS (
    VALUES (1, 16, 20), (2, 50, 22), (3, 84, 18), (4, 18, 52), (5, 52, 50), (6, 82, 48),
           (7, 20, 82), (8, 48, 85), (9, 80, 80), (10, 34, 34), (11, 66, 66)
)
UPDATE eventos e
SET baliza_x = p.bx, baliza_y = p.by
FROM defesas d
JOIN pontos p ON p.n = ((d.n - 1) % 11) + 1
WHERE e.id = d.id
  AND NOT EXISTS (SELECT 1 FROM eventos WHERE baliza_x IS NOT NULL);
