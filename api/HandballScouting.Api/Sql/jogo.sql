-- Dados de um jogo
SELECT g.id,
       g.codigo,
       g.data_hora,
       g.local,
       g.terminado_em,
       c.id   AS casa_id,
       c.nome AS casa_nome,
       escudo_versao(c.id) AS casa_escudo,
       f.id   AS fora_id,
       f.nome AS fora_nome,
       escudo_versao(f.id) AS fora_escudo
FROM jogos g
JOIN equipas c ON c.id = g.equipa_casa_id
JOIN equipas f ON f.id = g.equipa_fora_id
WHERE g.id = @jogoId;
