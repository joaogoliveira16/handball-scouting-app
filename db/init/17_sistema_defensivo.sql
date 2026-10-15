-- Sistema defensivo do adversário: contra que defesa (6:0, 5:1, 3:2:1, 4:2 ou individual) foi feito cada remate.
-- Este ficheiro é idempotente: também serve para atualizar uma base de dados já existente
-- (o docker compose corre-o sozinho em cada arranque; ver o serviço "migrar").
--
-- O adjunto escolhe a defesa do adversário no banco e ela fica escolhida até a mudar; cada remate leva o sistema
-- que estava escolhido. Só conta em ataque posicional: no contra-ataque e nos 7 metros não há uma defesa montada.
-- Sem sistema escolhido o campo fica a NULL (os remates antigos também).
--   6_0 | 5_1 | 3_2_1 | 4_2 | INDIVIDUAL

ALTER TABLE eventos ADD COLUMN IF NOT EXISTS sistema_defensivo VARCHAR(10)
    CHECK (sistema_defensivo IN ('6_0', '5_1', '3_2_1', '4_2', 'INDIVIDUAL'));

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sistema_coerente' AND conrelid = 'eventos'::regclass) THEN
        ALTER TABLE eventos ADD CONSTRAINT sistema_coerente CHECK (
            sistema_defensivo IS NULL OR (resultado IS NOT NULL AND situacao = 'POSICIONAL')
        );
    END IF;
END
$$;

-- A vista dos remates passa a incluir o sistema defensivo (a coluna nova fica no fim)
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
       e.baliza_zona,
       e.sistema_defensivo
FROM eventos e
JOIN tipos_evento t ON t.codigo = e.tipo_evento_codigo AND t.e_remate
JOIN jogadores    j ON j.id = e.jogador_id
WHERE e.resultado IS NOT NULL;

-- Jogo de exemplo (2): os remates posicionais fictícios ficam com a defesa que o adversário jogava (a maior parte
-- em 6:0, alguns em 5:1 e um em cada seis sem defesa escolhida), só se ainda não houver nenhum sistema registado
WITH posicionais AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY equipa_id ORDER BY id) AS n
    FROM eventos
    WHERE jogo_id = 2 AND resultado IS NOT NULL AND situacao = 'POSICIONAL'
      AND NOT EXISTS (SELECT 1 FROM eventos WHERE jogo_id = 2 AND sistema_defensivo IS NOT NULL)
)
UPDATE eventos e
SET sistema_defensivo = CASE p.n % 6 WHEN 0 THEN NULL WHEN 4 THEN '5_1' WHEN 5 THEN '5_1' ELSE '6_0' END
FROM posicionais p
WHERE e.id = p.id;
