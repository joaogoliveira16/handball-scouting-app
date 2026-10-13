-- Equipas, jogadores e jogos de exemplo (fictícios).
-- Substitui por as tuas equipas e jogadores reais.

INSERT INTO equipas (id, nome) VALUES
    (1, 'Águias do Norte'),
    (2, 'Leões do Sul');

INSERT INTO jogadores (id, equipa_id, numero, nome, posicao_codigo) VALUES
    (1,  1,  1, 'Rui Mesquita',    'GR'),
    (2,  1, 12, 'Tomás Faria',     'GR'),
    (3,  1,  7, 'Diogo Pires',     'PE'),
    (4,  1,  9, 'André Cunha',     'LE'),
    (5,  1,  5, 'Miguel Sousa',    'CE'),
    (6,  1, 10, 'Hugo Teixeira',   'LD'),
    (7,  1, 11, 'Bruno Lopes',     'PD'),
    (8,  1,  4, 'Pedro Rangel',    'PV'),
    (9,  2, 16, 'Nuno Viana',      'GR'),
    (10, 2,  1, 'Carlos Matos',    'GR'),
    (11, 2,  6, 'Rafael Dias',     'PE'),
    (12, 2,  8, 'Tiago Neves',     'LE'),
    (13, 2,  3, 'Filipe Amaral',   'CE'),
    (14, 2, 14, 'Gonçalo Reis',    'LD'),
    (15, 2, 19, 'João Barros',     'PD'),
    (16, 2, 20, 'Ricardo Faria',   'PV');

INSERT INTO jogos (id, equipa_casa_id, equipa_fora_id, data_hora, local) VALUES
    (1, 1, 2, now() - interval '3 days', 'Pavilhão (jogo de teste, sem eventos)'),
    (2, 1, 2, now() - interval '3 days', 'Demonstração (dados fictícios)');

-- Como as linhas acima têm ids explícitos, acertar as sequências
SELECT setval(pg_get_serial_sequence('equipas',   'id'), (SELECT MAX(id) FROM equipas));
SELECT setval(pg_get_serial_sequence('jogadores', 'id'), (SELECT MAX(id) FROM jogadores));
SELECT setval(pg_get_serial_sequence('jogos',     'id'), (SELECT MAX(id) FROM jogos));
