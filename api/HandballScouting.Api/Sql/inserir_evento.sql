-- corredor e distancia são colunas geradas pelo PostgreSQL a partir de x e y
INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, guarda_redes_id,
                     resultado, situacao, x, y, parte, segundo_jogo)
VALUES (@jogoId, @equipaId, @tipo, @jogadorId, @guardaRedesId,
        @resultado, @situacao, @x, @y, @parte, @segundoJogo)
RETURNING id;
