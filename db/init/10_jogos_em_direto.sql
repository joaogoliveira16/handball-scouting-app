-- Jogos na área de convidado: quem não tem conta vê a lista dos jogos das últimas 24 horas e abre-os sem link.
-- Este ficheiro é idempotente: também serve para atualizar uma base de dados já existente
-- (o docker compose corre-o sozinho em cada arranque; ver o serviço "migrar").
--
-- Regras:
--   * jogos.visivel_convidados: o dono pode esconder um jogo da área de convidado (por omissão aparece).
--     Esconder não apaga o link de partilha: quem o tem continua a ver o jogo.
--   * Um jogo está aberto a todos durante 24 horas (a API diz quantos minutos): conta a partir do último evento
--     registado ou, se ainda não há eventos, da data e hora do jogo (também aparece nas 24 horas antes de começar).
--     Passado esse tempo só se abre com o link de partilha ou com a conta do dono.

ALTER TABLE jogos ADD COLUMN IF NOT EXISTS visivel_convidados BOOLEAN NOT NULL DEFAULT TRUE;

-- Último evento de cada jogo (é a partir dele que se conta a janela)
CREATE INDEX IF NOT EXISTS ix_eventos_jogo_criado ON eventos (jogo_id, criado_em DESC);

-- ---------------------------------------------------------------------
-- Um jogo está aberto a toda a gente? Sim se o dono não o escondeu e o seu momento (último evento ou, sem eventos,
-- data e hora do jogo) está a menos de p_minutos de agora, para trás ou para a frente.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION jogo_aberto_a_convidados(p_jogo_id INT, p_minutos INT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT COALESCE((
        SELECT m.momento BETWEEN now() - make_interval(mins => p_minutos) AND now() + make_interval(mins => p_minutos)
        FROM jogos g
        CROSS JOIN LATERAL (
            SELECT COALESCE((SELECT MAX(e.criado_em) FROM eventos e WHERE e.jogo_id = g.id), g.data_hora) AS momento
        ) m
        WHERE g.id = p_jogo_id AND g.visivel_convidados
    ), FALSE)
$$;
