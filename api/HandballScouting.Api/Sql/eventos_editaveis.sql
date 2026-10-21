-- Todos os eventos de um jogo com tudo o que é preciso para os corrigir (a página «Eventos do jogo»):
-- do mais antigo para o mais recente pelo relógio de jogo, e pela ordem de registo quando coincidem.
SELECT e.id,
       e.equipa_id,
       e.tipo_evento_codigo AS tipo_evento,
       t.nome               AS tipo_nome,
       t.e_remate,
       e.jogador_id,
       j.numero             AS jogador_numero,
       j.nome               AS jogador_nome,
       e.guarda_redes_id,
       gr.numero            AS guarda_redes_numero,
       gr.nome              AS guarda_redes_nome,
       e.resultado,
       e.situacao,
       e.x,
       e.y,
       e.baliza_x,
       e.baliza_y,
       e.baliza_zona,
       e.sistema_defensivo,
       e.parte,
       e.segundo_jogo
FROM eventos e
JOIN tipos_evento t ON t.codigo = e.tipo_evento_codigo
LEFT JOIN jogadores j  ON j.id  = e.jogador_id
LEFT JOIN jogadores gr ON gr.id = e.guarda_redes_id
WHERE e.jogo_id = @jogoId
ORDER BY e.parte, e.segundo_jogo, e.id;
