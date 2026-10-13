-- Jogos em direto na área de convidado: quem não tem conta vê a lista dos jogos que estão a ser registados agora.
-- Este ficheiro é idempotente: também serve para atualizar uma base de dados já existente
-- (o docker compose corre-o sozinho em cada arranque; ver o serviço "migrar").
--
-- Regras:
--   * jogos.visivel_convidados: o dono pode esconder um jogo da área de convidado (por omissão aparece).
--     Esconder não apaga o link de partilha: quem o tem continua a ver o jogo.
--   * Um jogo está "em direto" quando o último evento tem poucos minutos (a API decide quantos). Sem eventos
--     registados, o jogo não aparece na lista.
--   * Quem abriu um jogo em direto pode continuar a vê-lo durante algumas horas depois do último evento
--     (intervalos, recarregar a página, os minutos a seguir ao fim). Passado esse tempo só com o link.

ALTER TABLE jogos ADD COLUMN IF NOT EXISTS visivel_convidados BOOLEAN NOT NULL DEFAULT TRUE;

-- Último evento de cada jogo (o que decide se está em direto)
CREATE INDEX IF NOT EXISTS ix_eventos_jogo_criado ON eventos (jogo_id, criado_em DESC);

-- ---------------------------------------------------------------------
-- Um jogo está aberto a toda a gente? Sim se o dono não o escondeu e o último evento tem menos de p_minutos.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION jogo_aberto_a_convidados(p_jogo_id INT, p_minutos INT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT COALESCE((
        SELECT (SELECT MAX(e.criado_em) FROM eventos e WHERE e.jogo_id = g.id) > now() - make_interval(mins => p_minutos)
        FROM jogos g
        WHERE g.id = p_jogo_id AND g.visivel_convidados
    ), FALSE)
$$;
