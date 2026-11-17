-- Os jogos de todas as contas, do mais recente para o mais antigo, para a página de administração (Jogos)
SELECT g.id,
       g.data_hora,
       g.local,
       g.terminado_em,
       g.dono_id,
       d.nome AS dono_nome,
       c.nome AS casa_nome,
       f.nome AS fora_nome,
       COUNT(r.id) FILTER (WHERE r.resultado = 'GOLO' AND r.equipa_id = g.equipa_casa_id) AS golos_casa,
       COUNT(r.id) FILTER (WHERE r.resultado = 'GOLO' AND r.equipa_id = g.equipa_fora_id) AS golos_fora,
       (SELECT COUNT(*) FROM eventos e WHERE e.jogo_id = g.id) AS eventos
FROM jogos g
JOIN equipas c ON c.id = g.equipa_casa_id
JOIN equipas f ON f.id = g.equipa_fora_id
LEFT JOIN utilizadores d ON d.id = g.dono_id
LEFT JOIN v_remates r ON r.jogo_id = g.id
GROUP BY g.id, c.id, f.id, d.id
ORDER BY g.data_hora DESC, g.id DESC
LIMIT 500;
