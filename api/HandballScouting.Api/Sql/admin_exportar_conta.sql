-- Todos os dados de uma conta num só JSON (a cópia de segurança que se guarda antes de a eliminar): a conta (sem a
-- palavra-passe), as equipas com os escudos, os jogadores, e os jogos com a convocatória, o relógio e os eventos.
-- Entram os jogos que saem com a conta ao eliminá-la (os dela e os que usam equipas dela) e, com eles, as equipas
-- do adversário, para o ficheiro ficar completo. Nada se devolve se a conta não existe.
WITH equipas_da_conta AS (
    SELECT e.id FROM equipas e WHERE e.dono_id = @id
), jogos_da_conta AS (
    SELECT j.id, j.equipa_casa_id, j.equipa_fora_id FROM jogos j
    WHERE j.dono_id = @id
       OR j.equipa_casa_id IN (SELECT id FROM equipas_da_conta)
       OR j.equipa_fora_id IN (SELECT id FROM equipas_da_conta)
), equipas_no_ficheiro AS (
    SELECT id FROM equipas_da_conta
    UNION SELECT equipa_casa_id FROM jogos_da_conta
    UNION SELECT equipa_fora_id FROM jogos_da_conta
)
SELECT jsonb_pretty(jsonb_build_object(
    'versao', 1,
    'tipo', 'conta',
    'exportado_em', now(),
    'conta', (SELECT to_jsonb(u) - 'palavra_passe_hash' FROM utilizadores u WHERE u.id = @id),
    'equipas', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM equipas e WHERE e.id IN (SELECT id FROM equipas_no_ficheiro)), '[]'::jsonb),
    'escudos', COALESCE((SELECT jsonb_agg(jsonb_build_object('equipa_id', s.equipa_id, 'tipo', s.tipo, 'dados_base64', encode(s.dados, 'base64')) ORDER BY s.equipa_id)
                         FROM escudos s WHERE s.equipa_id IN (SELECT id FROM equipas_no_ficheiro)), '[]'::jsonb),
    'jogadores', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM jogadores p WHERE p.equipa_id IN (SELECT id FROM equipas_no_ficheiro)), '[]'::jsonb),
    'jogos', COALESCE((SELECT jsonb_agg(to_jsonb(j) ORDER BY j.id) FROM jogos j WHERE j.id IN (SELECT id FROM jogos_da_conta)), '[]'::jsonb),
    'convocados', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.jogo_id, c.jogador_id) FROM convocados c WHERE c.jogo_id IN (SELECT id FROM jogos_da_conta)), '[]'::jsonb),
    'relogios', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.jogo_id) FROM relogios_jogo r WHERE r.jogo_id IN (SELECT id FROM jogos_da_conta)), '[]'::jsonb),
    'eventos', COALESCE((SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.id) FROM eventos ev WHERE ev.jogo_id IN (SELECT id FROM jogos_da_conta)), '[]'::jsonb)
)) AS json
WHERE EXISTS (SELECT 1 FROM utilizadores u WHERE u.id = @id);
