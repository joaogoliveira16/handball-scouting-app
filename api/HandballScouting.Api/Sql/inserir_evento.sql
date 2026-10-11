-- corredor, distancia e baliza_zona são colunas geradas pelo PostgreSQL a partir de x, y, baliza_x e baliza_y
INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, guarda_redes_id,
                     resultado, situacao, x, y, parte, segundo_jogo, baliza_x, baliza_y)
VALUES (@jogoId, @equipaId, @tipo, @jogadorId, @guardaRedesId,
        @resultado, @situacao, @x, @y, @parte, @segundoJogo, @balizaX, @balizaY)
RETURNING id;
