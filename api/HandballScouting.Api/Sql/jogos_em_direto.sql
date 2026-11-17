-- Jogos abertos a convidados: os que o dono não escondeu e cujo último evento (ou, sem eventos, a data do jogo)
-- está dentro da janela. Mostra o resultado, mas não o código do link de partilha.
-- "candidatos" encontra pelos índices os únicos jogos que podem estar abertos (um evento recente ou a data do jogo
-- dentro da janela), em vez de passar por todos os jogos da base de dados; a regra exata vem a seguir.
WITH candidatos AS (
    SELECT e.jogo_id AS id FROM eventos e WHERE e.criado_em >= now() - make_interval(mins => @minutos)
    UNION
    SELECT g.id FROM jogos g
    WHERE g.data_hora BETWEEN now() - make_interval(mins => @minutos) AND now() + make_interval(mins => @minutos)
)
SELECT g.id,
       g.data_hora,
       g.local,
       c.id   AS casa_id,
       c.nome AS casa_nome,
       escudo_versao(c.id) AS casa_escudo,
       f.id   AS fora_id,
       f.nome AS fora_nome,
       escudo_versao(f.id) AS fora_escudo,
       u.ultimo_evento,
       golos.golos_casa,
       golos.golos_fora
FROM candidatos k
JOIN jogos g ON g.id = k.id
JOIN equipas c ON c.id = g.equipa_casa_id
JOIN equipas f ON f.id = g.equipa_fora_id
CROSS JOIN LATERAL (SELECT MAX(e.criado_em) AS ultimo_evento FROM eventos e WHERE e.jogo_id = g.id) u
CROSS JOIN LATERAL (
    SELECT COUNT(*) FILTER (WHERE r.resultado = 'GOLO' AND r.equipa_id = g.equipa_casa_id) AS golos_casa,
           COUNT(*) FILTER (WHERE r.resultado = 'GOLO' AND r.equipa_id = g.equipa_fora_id) AS golos_fora
    FROM v_remates r
    WHERE r.jogo_id = g.id
) golos
WHERE g.visivel_convidados
  AND jogo_aberto_a_convidados(g.id, @minutos)
ORDER BY u.ultimo_evento DESC NULLS LAST, g.data_hora, g.id DESC
LIMIT 50;
