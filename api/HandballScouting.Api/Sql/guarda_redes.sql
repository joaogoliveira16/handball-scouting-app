-- Guarda-redes: defesas, golos sofridos e % de defesa.
-- Remates à baliza = defesas + golos (fora, poste e bloqueados não contam).
SELECT gr.id        AS jogador_id,
       gr.equipa_id,
       gr.numero,
       gr.nome,
       COUNT(r.id) FILTER (WHERE r.resultado = 'DEFESA')                AS defesas,
       COUNT(r.id) FILTER (WHERE r.resultado = 'GOLO')                  AS golos_sofridos,
       COUNT(r.id) FILTER (WHERE r.resultado IN ('DEFESA', 'GOLO'))     AS remates_baliza,
       ROUND(100.0 * COUNT(r.id) FILTER (WHERE r.resultado = 'DEFESA')
             / NULLIF(COUNT(r.id) FILTER (WHERE r.resultado IN ('DEFESA', 'GOLO')), 0), 1) AS percentagem_defesa
FROM jogos g
JOIN jogadores gr ON gr.equipa_id IN (g.equipa_casa_id, g.equipa_fora_id) AND gr.posicao_codigo = 'GR'
LEFT JOIN v_remates r ON r.guarda_redes_id = gr.id AND r.jogo_id = g.id
WHERE g.id = @jogoId
GROUP BY gr.id, gr.equipa_id, gr.numero, gr.nome
HAVING COUNT(r.id) > 0
ORDER BY gr.equipa_id, gr.numero;
