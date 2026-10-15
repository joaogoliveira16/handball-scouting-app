-- Dados de referência (necessários para a aplicação funcionar)

INSERT INTO posicoes (codigo, nome) VALUES
    ('GR', 'Guarda-redes'),
    ('PE', 'Ponta esquerda'),
    ('LE', 'Lateral esquerdo'),
    ('CE', 'Central'),
    ('LD', 'Lateral direito'),
    ('PD', 'Ponta direita'),
    ('PV', 'Pivot');

INSERT INTO tipos_evento (codigo, nome, e_remate, ordem) VALUES
    ('REMATE',         'Remate',         TRUE,  1),
    ('FALTA_OFENSIVA', 'Falta ofensiva', FALSE, 2),
    ('PERDA_BOLA',     'Perda de bola',  FALSE, 3),
    ('DOIS_MINUTOS',   '2 minutos',      FALSE, 4),
    ('TIMEOUT',        'Time-out',       FALSE, 5);
