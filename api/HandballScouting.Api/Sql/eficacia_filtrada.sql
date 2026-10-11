-- Eficácia de remate com filtros opcionais. Cada filtro a NULL é ignorado.
-- O corredor funciona por prefixo: PONTA apanha PONTA_ESQ e PONTA_DIR.
-- Exemplo (lateral esquerdo, linha de 9 m, 2.ª parte): posicao=LE, distancia=LINHA_9M, parte=2
SELECT COUNT(*)                                       AS remates,
       COUNT(*) FILTER (WHERE r.resultado = 'GOLO')      AS golos,
       COUNT(*) FILTER (WHERE r.resultado = 'DEFESA')    AS defesas,
       COUNT(*) FILTER (WHERE r.resultado = 'FORA')      AS fora,
       COUNT(*) FILTER (WHERE r.resultado = 'POSTE')     AS poste,
       COUNT(*) FILTER (WHERE r.resultado = 'BLOQUEADO') AS bloqueados,
       ROUND(100.0 * COUNT(*) FILTER (WHERE r.resultado = 'GOLO') / NULLIF(COUNT(*), 0), 1) AS eficacia
FROM v_remates r
WHERE r.jogo_id = @jogoId
  AND (@equipaId::int    IS NULL OR r.equipa_id       = @equipaId::int)
  AND (@jogadorId::int   IS NULL OR r.jogador_id      = @jogadorId::int)
  AND (@posicao::text    IS NULL OR r.posicao_jogador = @posicao::text)
  AND (@corredor::text   IS NULL OR r.corredor LIKE @corredor::text || '%')
  AND (@distancia::text  IS NULL OR r.distancia       = @distancia::text)
  AND (@parte::smallint  IS NULL OR r.parte           = @parte::smallint)
  AND (@situacao::text   IS NULL OR r.situacao        = @situacao::text);
