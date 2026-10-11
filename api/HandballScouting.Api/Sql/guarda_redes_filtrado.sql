-- Defesas de cada guarda-redes com filtros opcionais (cada filtro a NULL é ignorado).
-- Exemplo (remates das pontas): corredor=PONTA
SELECT gr.id        AS jogador_id,
       gr.equipa_id,
       gr.numero,
       gr.nome,
       COUNT(*) FILTER (WHERE r.resultado = 'DEFESA')            AS defesas,
       COUNT(*) FILTER (WHERE r.resultado = 'GOLO')              AS golos_sofridos,
       COUNT(*) FILTER (WHERE r.resultado IN ('DEFESA', 'GOLO')) AS remates_baliza,
       ROUND(100.0 * COUNT(*) FILTER (WHERE r.resultado = 'DEFESA')
             / NULLIF(COUNT(*) FILTER (WHERE r.resultado IN ('DEFESA', 'GOLO')), 0), 1) AS percentagem_defesa
FROM v_remates r
JOIN jogadores gr ON gr.id = r.guarda_redes_id
WHERE r.jogo_id = @jogoId
  AND (@jogadorId::int   IS NULL OR gr.id         = @jogadorId::int)
  AND (@corredor::text   IS NULL OR r.corredor LIKE @corredor::text || '%')
  AND (@distancia::text  IS NULL OR r.distancia   = @distancia::text)
  AND (@parte::smallint  IS NULL OR r.parte       = @parte::smallint)
  AND (@situacao::text   IS NULL OR r.situacao    = @situacao::text)
GROUP BY gr.id, gr.equipa_id, gr.numero, gr.nome
ORDER BY gr.equipa_id, gr.numero;
