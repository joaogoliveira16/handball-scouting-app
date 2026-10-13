-- Expulsões: o "Vermelho direto" passa a ser um tipo de evento e as sanções de cada jogador ficam numa vista.
-- Este ficheiro é idempotente: também serve para atualizar uma base de dados já existente
-- (o docker compose corre-o sozinho em cada arranque; ver o serviço "migrar").
--
-- Regras do andebol (IHF):
--   * 3.º "2 minutos" ao mesmo jogador = desqualificação (fica fora do jogo);
--   * cartão vermelho direto = desqualificação.
-- Um jogador desqualificado deixa de poder ser escolhido no banco, mas os eventos que já tem ficam nas estatísticas.

-- O botão "Vermelho direto" aparece sozinho no banco (fica a seguir aos "2 minutos")
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM tipos_evento WHERE codigo = 'VERMELHO') THEN
        UPDATE tipos_evento SET ordem = ordem + 1 WHERE ordem > 4;
        INSERT INTO tipos_evento (codigo, nome, e_remate, ordem) VALUES ('VERMELHO', 'Vermelho direto', FALSE, 5);
    END IF;
END
$$;

-- Sanções por jogo e jogador (só quem tem pelo menos uma). É aqui que está a regra de quem fica expulso.
CREATE OR REPLACE VIEW v_sancoes AS
SELECT e.jogo_id,
       j.id        AS jogador_id,
       j.equipa_id,
       j.numero,
       j.nome,
       COUNT(*) FILTER (WHERE e.tipo_evento_codigo = 'DOIS_MINUTOS') AS dois_minutos,
       COUNT(*) FILTER (WHERE e.tipo_evento_codigo = 'VERMELHO')     AS vermelhos,
       (COUNT(*) FILTER (WHERE e.tipo_evento_codigo = 'VERMELHO') > 0
        OR COUNT(*) FILTER (WHERE e.tipo_evento_codigo = 'DOIS_MINUTOS') >= 3) AS expulso
FROM eventos e
JOIN jogadores j ON j.id = e.jogador_id
WHERE e.tipo_evento_codigo IN ('DOIS_MINUTOS', 'VERMELHO')
GROUP BY e.jogo_id, j.id, j.equipa_id, j.numero, j.nome;
