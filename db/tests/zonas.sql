-- Testes das funções de zona. Correr com:
--   psql -v ON_ERROR_STOP=1 -f db/tests/zonas.sql
-- Qualquer ASSERT falhado faz o script terminar com erro (usado no GitHub Actions).

DO $$
BEGIN
    -- Distâncias (baliza no topo, centrada em x = 50)
    ASSERT zona_distancia(50, 10) = 'ATE_6M',     'centro a 2 m devia ser ATE_6M';
    ASSERT zona_distancia(50, 35) = 'DE_6_A_9M',  'marca de 7 m devia ser DE_6_A_9M';
    ASSERT zona_distancia(50, 47) = 'LINHA_9M',   'centro a 9,4 m devia ser LINHA_9M';
    ASSERT zona_distancia(50, 70) = 'MAIS_9M',    'centro a 14 m devia ser MAIS_9M';
    ASSERT zona_distancia(5, 10)  = 'DE_6_A_9M',  'ponta esquerda a ~7,8 m devia ser DE_6_A_9M';

    -- Corredores
    ASSERT zona_corredor(5, 10)  = 'PONTA_ESQ',    'canto esquerdo devia ser PONTA_ESQ';
    ASSERT zona_corredor(95, 10) = 'PONTA_DIR',    'canto direito devia ser PONTA_DIR';
    ASSERT zona_corredor(20, 50) = 'LATERAL_ESQ',  'x = 20 devia ser LATERAL_ESQ';
    ASSERT zona_corredor(80, 50) = 'LATERAL_DIR',  'x = 80 devia ser LATERAL_DIR';
    ASSERT zona_corredor(50, 50) = 'CENTRAL',      'centro devia ser CENTRAL';
    -- x baixo mas já longe da linha de baliza deixa de ser ponta
    ASSERT zona_corredor(5, 60)  = 'LATERAL_ESQ',  'x = 5, y = 60 devia ser LATERAL_ESQ';

    -- Sem coordenadas (eventos que não são remates) não há zona
    ASSERT zona_corredor(NULL, NULL) IS NULL, 'sem coordenadas devia ser NULL';
END
$$;

-- As colunas geradas da tabela eventos têm de bater com as funções
DO $$
DECLARE
    v_corredor  TEXT;
    v_distancia TEXT;
BEGIN
    SELECT corredor, distancia INTO v_corredor, v_distancia
    FROM eventos
    WHERE jogo_id = 2 AND situacao = 'SETE_METROS'
    LIMIT 1;

    ASSERT v_corredor  = 'CENTRAL',   'remate de 7 m devia estar no corredor CENTRAL';
    ASSERT v_distancia = 'DE_6_A_9M', 'remate de 7 m devia estar em DE_6_A_9M';
END
$$;

SELECT 'testes de zonas: OK' AS resultado;
