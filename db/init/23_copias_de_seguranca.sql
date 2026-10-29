-- Cópias de segurança: o que a restauração (pg_restore) precisa para funcionar.
-- Este ficheiro é idempotente: também serve para atualizar uma base de dados já existente
-- (o docker compose corre-o sozinho em cada arranque; ver o serviço "migrar").
--
-- Ao restaurar, o pg_restore corre com o search_path vazio (é a defesa do PostgreSQL contra funções trocadas por
-- outro esquema). As colunas calculadas dos eventos (corredor, distância, zona da baliza) chamam funções; se uma
-- função chamar outra sem dizer o esquema, a restauração falha com «function zona_distancia_m does not exist».
-- Por isso zona_distancia chama public.zona_distancia_m. Os valores calculados são os mesmos de antes.

CREATE OR REPLACE FUNCTION zona_distancia(x NUMERIC, y NUMERIC) RETURNS VARCHAR
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT CASE
        WHEN public.zona_distancia_m(x, y) < 6  THEN 'ATE_6M'
        WHEN public.zona_distancia_m(x, y) < 9  THEN 'DE_6_A_9M'
        WHEN public.zona_distancia_m(x, y) < 11 THEN 'LINHA_9M'
        ELSE 'MAIS_9M'
    END
$$;
