-- Superioridade numérica: 7×6 (ataque sem guarda-redes) e relógio do jogo guardado no servidor.
-- Este ficheiro é idempotente: também serve para atualizar uma base de dados já existente
-- (o docker compose corre-o sozinho em cada arranque; ver o serviço "migrar").
--
-- Os 2 minutos e o vermelho direto já são eventos (script 12). Quem está em inferioridade, e até quando, calcula-se
-- a partir deles e do segundo de jogo em que foram registados (ver api/.../Numerica.cs); aqui só falta registar
-- quando uma equipa passa a atacar com sete jogadores de campo (guarda-redes substituído) e quando volta ao normal.

DO $$
DECLARE
    v_ordem INT;
BEGIN
    SELECT COALESCE(MAX(ordem), 0) INTO v_ordem FROM tipos_evento;
    IF NOT EXISTS (SELECT 1 FROM tipos_evento WHERE codigo = 'SETE_SEIS_INICIO') THEN
        INSERT INTO tipos_evento (codigo, nome, e_remate, ordem)
        VALUES ('SETE_SEIS_INICIO', 'Ataque 7×6 (início)', FALSE, v_ordem + 1);
        v_ordem := v_ordem + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM tipos_evento WHERE codigo = 'SETE_SEIS_FIM') THEN
        INSERT INTO tipos_evento (codigo, nome, e_remate, ordem)
        VALUES ('SETE_SEIS_FIM', 'Ataque 7×6 (fim)', FALSE, v_ordem + 1);
    END IF;
END
$$;

-- O relógio vive no tablet do banco. Para o dashboard (e quem vê o link) saber em que minuto vai o jogo e quanto
-- falta a cada 2 minutos, o tablet avisa o servidor quando o relógio arranca, pára ou é ajustado, e de vez em
-- quando enquanto corre. Fica uma linha por jogo: o segundo em que estava e se estava a andar.
CREATE TABLE IF NOT EXISTS relogios_jogo (
    jogo_id       INT         PRIMARY KEY REFERENCES jogos (id) ON DELETE CASCADE,
    segundo       INT         NOT NULL CHECK (segundo BETWEEN 0 AND 7200),
    a_correr      BOOLEAN     NOT NULL DEFAULT FALSE,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
