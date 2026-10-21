-- Os números de cada jogador de uma equipa da conta em cada jogo em que entrou (convocado ou com eventos registados).
-- Uma linha por jogador e jogo; a página Estatísticas soma-as (ver frontend/js/estatisticas-jogadores.js).
--   remates / golos ...  : o que o jogador rematou (v_remates: o resultado é o do remate)
--   perdas_bola ... :      outros eventos do jogador
--   defesas ... :          o que o jogador defendeu como guarda-redes (remates em que é o guarda-redes adversário)
-- Remates à baliza do guarda-redes = defesas + golos sofridos (fora, poste e bloqueados não contam).
-- Com o parâmetro parte (1 ou 2) só contam os jogos com eventos nessa parte e só os eventos dessa parte; sem ela (null), o jogo todo.
SELECT j.id AS jogador_id,
       g.id AS jogo_id,
       s.remates,
       s.golos,
       s.defendidos,
       s.fora,
       s.poste,
       s.bloqueados,
       s.sete_metros,
       s.golos_sete_metros,
       s.contra_ataques,
       s.golos_contra_ataque,
       o.perdas_bola,
       o.faltas_ofensivas,
       o.dois_minutos,
       o.vermelhos,
       d.defesas,
       d.golos_sofridos,
       d.sete_metros_sofridos,
       d.defesas_sete_metros
FROM jogos g
JOIN jogadores j ON j.equipa_id = @equipaId
CROSS JOIN LATERAL (
    SELECT COUNT(*)                                                      AS remates,
           COUNT(*) FILTER (WHERE r.resultado = 'GOLO')                  AS golos,
           COUNT(*) FILTER (WHERE r.resultado = 'DEFESA')                AS defendidos,
           COUNT(*) FILTER (WHERE r.resultado = 'FORA')                  AS fora,
           COUNT(*) FILTER (WHERE r.resultado = 'POSTE')                 AS poste,
           COUNT(*) FILTER (WHERE r.resultado = 'BLOQUEADO')             AS bloqueados,
           COUNT(*) FILTER (WHERE r.situacao = 'SETE_METROS')            AS sete_metros,
           COUNT(*) FILTER (WHERE r.situacao = 'SETE_METROS' AND r.resultado = 'GOLO')   AS golos_sete_metros,
           COUNT(*) FILTER (WHERE r.situacao = 'CONTRA_ATAQUE')          AS contra_ataques,
           COUNT(*) FILTER (WHERE r.situacao = 'CONTRA_ATAQUE' AND r.resultado = 'GOLO') AS golos_contra_ataque
    FROM v_remates r
    WHERE r.jogo_id = g.id AND r.jogador_id = j.id AND (@parte::smallint IS NULL OR r.parte = @parte::smallint)
) s
CROSS JOIN LATERAL (
    SELECT COUNT(*)                                                      AS eventos,
           COUNT(*) FILTER (WHERE e.tipo_evento_codigo = 'PERDA_BOLA')     AS perdas_bola,
           COUNT(*) FILTER (WHERE e.tipo_evento_codigo = 'FALTA_OFENSIVA') AS faltas_ofensivas,
           COUNT(*) FILTER (WHERE e.tipo_evento_codigo = 'DOIS_MINUTOS')   AS dois_minutos,
           COUNT(*) FILTER (WHERE e.tipo_evento_codigo = 'VERMELHO')       AS vermelhos
    FROM eventos e
    WHERE e.jogo_id = g.id AND e.jogador_id = j.id AND (@parte::smallint IS NULL OR e.parte = @parte::smallint)
) o
CROSS JOIN LATERAL (
    SELECT COUNT(*) FILTER (WHERE r.resultado = 'DEFESA')                AS defesas,
           COUNT(*) FILTER (WHERE r.resultado = 'GOLO')                  AS golos_sofridos,
           COUNT(*) FILTER (WHERE r.situacao = 'SETE_METROS' AND r.resultado IN ('DEFESA', 'GOLO')) AS sete_metros_sofridos,
           COUNT(*) FILTER (WHERE r.situacao = 'SETE_METROS' AND r.resultado = 'DEFESA')            AS defesas_sete_metros,
           COUNT(*)                                                      AS remates_contra
    FROM v_remates r
    WHERE r.jogo_id = g.id AND r.guarda_redes_id = j.id AND (@parte::smallint IS NULL OR r.parte = @parte::smallint)
) d
WHERE g.dono_id = @donoId
  AND @equipaId IN (g.equipa_casa_id, g.equipa_fora_id)
  AND EXISTS (SELECT 1 FROM eventos e WHERE e.jogo_id = g.id AND (@parte::smallint IS NULL OR e.parte = @parte::smallint))
  AND (EXISTS (SELECT 1 FROM convocados c WHERE c.jogo_id = g.id AND c.jogador_id = j.id)
       OR s.remates > 0 OR o.eventos > 0 OR d.remates_contra > 0)
ORDER BY j.id, g.data_hora, g.id;
