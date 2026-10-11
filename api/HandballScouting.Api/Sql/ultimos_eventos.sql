SELECT e.id,
       e.equipa_id,
       eq.nome AS equipa_nome,
       e.tipo_evento_codigo AS tipo,
       t.nome  AS tipo_nome,
       j.numero AS jogador_numero,
       j.nome   AS jogador_nome,
       e.resultado,
       e.situacao,
       e.parte,
       e.segundo_jogo,
       e.criado_em
FROM eventos e
JOIN equipas eq     ON eq.id = e.equipa_id
JOIN tipos_evento t ON t.codigo = e.tipo_evento_codigo
LEFT JOIN jogadores j ON j.id = e.jogador_id
WHERE e.jogo_id = @jogoId
ORDER BY e.id DESC
LIMIT @limite;
