-- Um jogo num só JSON (a cópia de segurança que se guarda antes de o apagar): o jogo, as duas equipas e os jogadores
-- delas, a convocatória, o relógio e os eventos. Nada se devolve se o jogo não existe.
SELECT jsonb_pretty(jsonb_build_object(
    'versao', 1,
    'tipo', 'jogo',
    'exportado_em', now(),
    'jogo', to_jsonb(j),
    'equipas', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM equipas e WHERE e.id IN (j.equipa_casa_id, j.equipa_fora_id)),
    'jogadores', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM jogadores p WHERE p.equipa_id IN (j.equipa_casa_id, j.equipa_fora_id)), '[]'::jsonb),
    'convocados', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.jogador_id) FROM convocados c WHERE c.jogo_id = j.id), '[]'::jsonb),
    'relogios', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM relogios_jogo r WHERE r.jogo_id = j.id), '[]'::jsonb),
    'eventos', COALESCE((SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.id) FROM eventos ev WHERE ev.jogo_id = j.id), '[]'::jsonb)
)) AS json
FROM jogos j
WHERE j.id = @id;
