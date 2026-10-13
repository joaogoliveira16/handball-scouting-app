-- corredor, distancia e baliza_zona são colunas geradas pelo PostgreSQL a partir de x, y, baliza_x e baliza_y.
-- Com cliente_id (o identificador que o tablet gerou), repetir o mesmo evento não faz nada: não devolve linhas e
-- o evento que já existia é lido por evento_por_cliente.sql.
INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, guarda_redes_id,
                     resultado, situacao, x, y, parte, segundo_jogo, baliza_x, baliza_y, cliente_id, criado_em)
VALUES (@jogoId, @equipaId, @tipo, @jogadorId, @guardaRedesId,
        @resultado, @situacao, @x, @y, @parte, @segundoJogo, @balizaX, @balizaY, @clienteId, @criadoEm)
ON CONFLICT (jogo_id, cliente_id) WHERE cliente_id IS NOT NULL DO NOTHING
RETURNING id;
