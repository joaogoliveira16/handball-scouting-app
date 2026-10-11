-- =====================================================================
-- Esquema da base de dados (PostgreSQL 16)
-- Executado automaticamente pelo contentor "db" na primeira vez que arranca
-- (ficheiros de /docker-entrypoint-initdb.d, por ordem alfabética).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabelas de referência
-- ---------------------------------------------------------------------
CREATE TABLE posicoes (
    codigo VARCHAR(2)  PRIMARY KEY,          -- GR, PE, LE, CE, LD, PD, PV
    nome   VARCHAR(40) NOT NULL
);

-- Tipos de evento. Para contabilizar algo novo (ex.: passe errado) basta
-- inserir uma linha aqui; o frontend cria o botão automaticamente.
CREATE TABLE tipos_evento (
    codigo   VARCHAR(30) PRIMARY KEY,
    nome     VARCHAR(60) NOT NULL,
    e_remate BOOLEAN     NOT NULL DEFAULT FALSE,  -- TRUE = leva posição no campo, jogador e resultado
    ordem    SMALLINT    NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------
-- Equipas, jogadores e jogos
-- ---------------------------------------------------------------------
CREATE TABLE equipas (
    id   SERIAL      PRIMARY KEY,
    nome VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE jogadores (
    id             SERIAL      PRIMARY KEY,
    equipa_id      INT         NOT NULL REFERENCES equipas (id),
    numero         SMALLINT    NOT NULL CHECK (numero BETWEEN 1 AND 99),
    nome           VARCHAR(80) NOT NULL,
    posicao_codigo VARCHAR(2)  NOT NULL REFERENCES posicoes (codigo),
    UNIQUE (equipa_id, numero)
);

CREATE TABLE jogos (
    id             SERIAL       PRIMARY KEY,
    equipa_casa_id INT          NOT NULL REFERENCES equipas (id),
    equipa_fora_id INT          NOT NULL REFERENCES equipas (id),
    data_hora      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    local          VARCHAR(120),
    CHECK (equipa_casa_id <> equipa_fora_id)
);

-- ---------------------------------------------------------------------
-- Zonas do campo (calculadas a partir das coordenadas do clique)
--
-- Coordenadas x, y em percentagem (0 a 100) do meio-campo de ataque, que
-- mede 20 m x 20 m. A baliza (3 m) está no topo (y = 0), centrada em x = 50.
--   x: 0 = lado esquerdo de quem ataca, 100 = lado direito
--   y: 0 = linha de baliza, 100 = linha do meio-campo
-- ---------------------------------------------------------------------

-- Distância em metros do ponto à baliza (segmento entre os dois postes).
-- É a mesma geometria das linhas de 6 m e 9 m desenhadas no mapa.
CREATE FUNCTION zona_distancia_m(x NUMERIC, y NUMERIC) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT sqrt(
        power(GREATEST(8.5 - x * 0.2, 0, x * 0.2 - 11.5), 2) +  -- afastamento lateral aos postes
        power(y * 0.2, 2)                                        -- profundidade
    )
$$;

-- Faixa de distância: ATE_6M | DE_6_A_9M | LINHA_9M (9 a 11 m) | MAIS_9M
CREATE FUNCTION zona_distancia(x NUMERIC, y NUMERIC) RETURNS VARCHAR
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT CASE
        WHEN zona_distancia_m(x, y) < 6  THEN 'ATE_6M'
        WHEN zona_distancia_m(x, y) < 9  THEN 'DE_6_A_9M'
        WHEN zona_distancia_m(x, y) < 11 THEN 'LINHA_9M'
        ELSE 'MAIS_9M'
    END
$$;

-- Corredor (zona lateral): PONTA_ESQ | LATERAL_ESQ | CENTRAL | LATERAL_DIR | PONTA_DIR
CREATE FUNCTION zona_corredor(x NUMERIC, y NUMERIC) RETURNS VARCHAR
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT CASE
        WHEN x < 18 AND y < 35 THEN 'PONTA_ESQ'
        WHEN x > 82 AND y < 35 THEN 'PONTA_DIR'
        WHEN x < 40            THEN 'LATERAL_ESQ'
        WHEN x > 60            THEN 'LATERAL_DIR'
        ELSE 'CENTRAL'
    END
$$;

-- ---------------------------------------------------------------------
-- Eventos (o coração do esquema)
-- ---------------------------------------------------------------------
CREATE TABLE eventos (
    id                 BIGSERIAL   PRIMARY KEY,
    jogo_id            INT         NOT NULL REFERENCES jogos (id) ON DELETE CASCADE,
    equipa_id          INT         NOT NULL REFERENCES equipas (id),   -- equipa a que o evento diz respeito (a que ataca)
    tipo_evento_codigo VARCHAR(30) NOT NULL REFERENCES tipos_evento (codigo),
    jogador_id         INT         REFERENCES jogadores (id),          -- quem rematou / cometeu a falta
    guarda_redes_id    INT         REFERENCES jogadores (id),          -- guarda-redes adversário (só em remates)
    resultado          VARCHAR(12) CHECK (resultado IN ('GOLO', 'DEFESA', 'FORA', 'POSTE', 'BLOQUEADO')),
    situacao           VARCHAR(15) NOT NULL DEFAULT 'POSICIONAL'
                       CHECK (situacao IN ('POSICIONAL', 'CONTRA_ATAQUE', 'SETE_METROS')),
    x                  NUMERIC(5, 2) CHECK (x BETWEEN 0 AND 100),
    y                  NUMERIC(5, 2) CHECK (y BETWEEN 0 AND 100),
    -- Colunas derivadas: o PostgreSQL calcula-as sozinho a partir de x, y
    corredor           VARCHAR(12) GENERATED ALWAYS AS (zona_corredor(x, y))  STORED,
    distancia          VARCHAR(12) GENERATED ALWAYS AS (zona_distancia(x, y)) STORED,
    parte              SMALLINT    NOT NULL CHECK (parte IN (1, 2)),
    segundo_jogo       INT         NOT NULL DEFAULT 0 CHECK (segundo_jogo >= 0),  -- segundos desde o início do jogo
    criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Se há resultado, tem de haver jogador e posição no campo
    CONSTRAINT remate_completo CHECK (
        resultado IS NULL OR (jogador_id IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL)
    )
);

CREATE INDEX ix_eventos_jogo        ON eventos (jogo_id, id);
CREATE INDEX ix_eventos_jogo_equipa ON eventos (jogo_id, equipa_id, tipo_evento_codigo);
CREATE INDEX ix_eventos_jogador     ON eventos (jogador_id);
CREATE INDEX ix_eventos_gr          ON eventos (guarda_redes_id);

-- ---------------------------------------------------------------------
-- Vista de conveniência: só remates, já com os dados do jogador
-- ---------------------------------------------------------------------
CREATE VIEW v_remates AS
SELECT e.id,
       e.jogo_id,
       e.equipa_id,
       e.jogador_id,
       e.guarda_redes_id,
       e.resultado,
       e.situacao,
       e.x,
       e.y,
       e.corredor,
       e.distancia,
       e.parte,
       e.segundo_jogo,
       e.criado_em,
       j.numero         AS jogador_numero,
       j.nome           AS jogador_nome,
       j.posicao_codigo AS posicao_jogador
FROM eventos e
JOIN tipos_evento t ON t.codigo = e.tipo_evento_codigo AND t.e_remate
JOIN jogadores    j ON j.id = e.jogador_id
WHERE e.resultado IS NOT NULL;
