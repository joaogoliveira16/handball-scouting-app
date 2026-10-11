-- Eventos fictícios do jogo 2 (demonstração do dashboard).
-- Apaga este ficheiro (ou o jogo 2) quando começares a usar dados reais.
-- Colunas: jogo, equipa, tipo, jogador, guarda-redes, resultado, situação, x, y, parte, segundo_jogo
-- Nota: nos últimos 5 minutos a equipa 2 marca 3 golos seguidos (dispara o aviso de time-out).

INSERT INTO eventos (jogo_id, equipa_id, tipo_evento_codigo, jogador_id, guarda_redes_id, resultado, situacao, x, y, parte, segundo_jogo) VALUES
    -- 1.ª parte (guarda-redes: equipa 1 -> id 1, equipa 2 -> id 9)
    (2, 1, 'REMATE',         4,    9,    'DEFESA',    'POSICIONAL',    30, 52, 1,   60),
    (2, 2, 'REMATE',        12,    1,    'GOLO',      'POSICIONAL',    28, 50, 1,  130),
    (2, 1, 'REMATE',         3,    9,    'GOLO',      'POSICIONAL',     7, 12, 1,  205),
    (2, 2, 'REMATE',        15,    1,    'DEFESA',    'POSICIONAL',    93, 15, 1,  280),
    (2, 1, 'REMATE',         6,    9,    'GOLO',      'POSICIONAL',    72, 51, 1,  350),
    (2, 2, 'REMATE',        13,    1,    'FORA',      'POSICIONAL',    50, 55, 1,  420),
    (2, 1, 'FALTA_OFENSIVA', 5, NULL,    NULL,        'POSICIONAL',  NULL, NULL, 1, 450),
    (2, 1, 'REMATE',         8,    9,    'GOLO',      'POSICIONAL',    52, 20, 1,  500),
    (2, 2, 'REMATE',        14,    1,    'GOLO',      'POSICIONAL',    70, 48, 1,  580),
    (2, 1, 'REMATE',         5,    9,    'DEFESA',    'POSICIONAL',    48, 56, 1,  660),
    (2, 1, 'PERDA_BOLA',     4, NULL,    NULL,        'POSICIONAL',  NULL, NULL, 1, 700),
    (2, 2, 'REMATE',        11,    1,    'POSTE',     'POSICIONAL',     6, 14, 1,  740),
    (2, 1, 'REMATE',         7,    9,    'DEFESA',    'CONTRA_ATAQUE', 88, 22, 1,  820),
    (2, 2, 'REMATE',        16,    1,    'GOLO',      'POSICIONAL',    47, 18, 1,  900),
    (2, 1, 'REMATE',         4,    9,    'BLOQUEADO', 'POSICIONAL',    30, 54, 1,  980),
    (2, 2, 'FALTA_OFENSIVA',13, NULL,    NULL,        'POSICIONAL',  NULL, NULL, 1, 1000),
    (2, 2, 'REMATE',        12,    1,    'DEFESA',    'POSICIONAL',    27, 53, 1, 1060),
    (2, 1, 'REMATE',         6,    9,    'GOLO',      'SETE_METROS',   50, 35, 1, 1150),
    (2, 2, 'REMATE',        14,    1,    'FORA',      'POSICIONAL',    72, 52, 1, 1240),
    (2, 1, 'REMATE',         3,    9,    'DEFESA',    'POSICIONAL',     9, 10, 1, 1330),
    (2, 2, 'REMATE',        15,    1,    'GOLO',      'POSICIONAL',    91, 12, 1, 1420),
    (2, 2, 'PERDA_BOLA',    12, NULL,    NULL,        'POSICIONAL',  NULL, NULL, 1, 1500),
    (2, 1, 'REMATE',         5,    9,    'GOLO',      'POSICIONAL',    50, 50, 1, 1520),
    (2, 2, 'REMATE',        13,    1,    'DEFESA',    'POSICIONAL',    52, 57, 1, 1610),
    (2, 1, 'REMATE',         8,    9,    'FORA',      'POSICIONAL',    55, 25, 1, 1700),
    (2, 1, 'TIMEOUT',     NULL, NULL,    NULL,        'POSICIONAL',  NULL, NULL, 1, 1750),
    (2, 2, 'REMATE',        11,    1,    'GOLO',      'CONTRA_ATAQUE', 12, 15, 1, 1780),
    -- 2.ª parte (guarda-redes: equipa 1 -> id 2, equipa 2 -> id 10)
    (2, 1, 'REMATE',         4,   10,    'GOLO',      'POSICIONAL',    29, 50, 2, 1860),
    (2, 2, 'DOIS_MINUTOS',  14, NULL,    NULL,        'POSICIONAL',  NULL, NULL, 2, 1900),
    (2, 2, 'REMATE',        12,    2,    'DEFESA',    'POSICIONAL',    26, 52, 2, 1950),
    (2, 1, 'REMATE',         7,   10,    'DEFESA',    'POSICIONAL',    90, 18, 2, 2030),
    (2, 2, 'REMATE',        16,    2,    'GOLO',      'POSICIONAL',    53, 22, 2, 2110),
    (2, 1, 'REMATE',         6,   10,    'FORA',      'POSICIONAL',    73, 53, 2, 2190),
    (2, 2, 'REMATE',        14,    2,    'GOLO',      'POSICIONAL',    68, 46, 2, 2250),
    (2, 1, 'REMATE',         5,   10,    'DEFESA',    'POSICIONAL',    47, 58, 2, 2300),
    (2, 2, 'REMATE',        15,    2,    'GOLO',      'POSICIONAL',    92, 14, 2, 2340),
    (2, 1, 'REMATE',         3,   10,    'BLOQUEADO', 'POSICIONAL',    10, 15, 2, 2380),
    (2, 2, 'REMATE',        13,    2,    'GOLO',      'POSICIONAL',    50, 49, 2, 2410),
    (2, 1, 'REMATE',         8,   10,    'DEFESA',    'POSICIONAL',    50, 20, 2, 2440);
