-- Corrige um evento de um jogo da conta. Ficam como estavam o identificador do tablet (cliente_id), para que um
-- reenvio atrasado não o registe outra vez, e a hora de registo. corredor e distancia calculam-se sozinhos a partir de x e y.
UPDATE eventos e
SET equipa_id          = @equipaId,
    tipo_evento_codigo = @tipo,
    jogador_id         = @jogadorId,
    guarda_redes_id    = @guardaRedesId,
    resultado          = @resultado,
    situacao           = @situacao,
    x                  = @x,
    y                  = @y,
    parte              = @parte,
    segundo_jogo       = @segundoJogo,
    baliza_x           = @balizaX,
    baliza_y           = @balizaY,
    sistema_defensivo  = @sistemaDefensivo
FROM jogos g
WHERE e.id = @eventoId
  AND e.jogo_id = @jogoId
  AND g.id = e.jogo_id
  AND g.dono_id = @donoId
RETURNING e.id;
