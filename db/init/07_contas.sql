-- Contas de utilizador: cada conta tem as suas próprias equipas, jogadores e jogos.
-- Este ficheiro é idempotente: também serve para atualizar uma base de dados já existente
-- (o docker compose corre-o sozinho em cada arranque; ver o serviço "migrar").
--
-- Regras:
--   * utilizadores: email (sempre em minúsculas) e palavra-passe guardada só como hash (PBKDF2, calculado pela API).
--   * sessoes: o cookie do browser tem um código aleatório; aqui só fica o seu SHA-256.
--   * equipas.dono_id e jogos.dono_id: de quem é cada coisa. Os jogadores, a convocatória e os eventos
--     pertencem à equipa/jogo e por isso ao mesmo dono.
--   * jogos.codigo: código secreto do link de partilha. Quem tem o link (jogo + código) vê o dashboard em
--     direto sem conta; para registar ou editar é preciso ser o dono.
--   * A primeira conta criada fica com tudo o que já existia sem dono (incluindo os dados de exemplo).

CREATE TABLE IF NOT EXISTS utilizadores (
    id                 SERIAL       PRIMARY KEY,
    email              VARCHAR(160) NOT NULL UNIQUE CHECK (email = lower(email)),
    nome               VARCHAR(80)  NOT NULL,
    palavra_passe_hash VARCHAR(255) NOT NULL,
    criado_em          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessoes (
    token_hash    CHAR(64)    PRIMARY KEY,          -- SHA-256 (hex) do código que está no cookie
    utilizador_id INT         NOT NULL REFERENCES utilizadores (id) ON DELETE CASCADE,
    criada_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expira_em     TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessoes_utilizador ON sessoes (utilizador_id);

-- ---------------------------------------------------------------------
-- Dono das equipas e dos jogos
-- ---------------------------------------------------------------------
ALTER TABLE equipas ADD COLUMN IF NOT EXISTS dono_id INT REFERENCES utilizadores (id);
ALTER TABLE jogos   ADD COLUMN IF NOT EXISTS dono_id INT REFERENCES utilizadores (id);
CREATE INDEX IF NOT EXISTS ix_equipas_dono ON equipas (dono_id);
CREATE INDEX IF NOT EXISTS ix_jogos_dono   ON jogos (dono_id);

-- Código secreto do link de partilha (20 caracteres hexadecimais aleatórios, um por jogo)
ALTER TABLE jogos ADD COLUMN IF NOT EXISTS codigo VARCHAR(20) NOT NULL
    DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
CREATE UNIQUE INDEX IF NOT EXISTS ux_jogos_codigo ON jogos (codigo);

-- O nome da equipa só tem de ser único dentro da mesma conta
ALTER TABLE equipas DROP CONSTRAINT IF EXISTS equipas_nome_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_equipas_dono_nome ON equipas ((COALESCE(dono_id, 0)), nome);

-- Um jogo com dono só pode ter equipas do mesmo dono
CREATE OR REPLACE FUNCTION jogos_donos_coerentes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.dono_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM equipas e
        WHERE e.id IN (NEW.equipa_casa_id, NEW.equipa_fora_id) AND e.dono_id IS DISTINCT FROM NEW.dono_id
    ) THEN
        RAISE EXCEPTION 'as equipas do jogo têm de ser do mesmo dono do jogo' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS tg_jogos_donos ON jogos;
CREATE TRIGGER tg_jogos_donos
    BEFORE INSERT OR UPDATE OF dono_id, equipa_casa_id, equipa_fora_id ON jogos
    FOR EACH ROW EXECUTE FUNCTION jogos_donos_coerentes();

-- ---------------------------------------------------------------------
-- Criar uma conta. A primeira de todas adota as equipas e os jogos que ainda não têm dono
-- (assim quem já usava a app não perde nada). Devolve o id da conta nova.
-- Um email repetido dá unique_violation (a API responde 409).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION registar_utilizador(p_email TEXT, p_nome TEXT, p_hash TEXT) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
    v_id       INT;
    v_primeiro BOOLEAN;
BEGIN
    LOCK TABLE utilizadores IN SHARE ROW EXCLUSIVE MODE;   -- duas primeiras contas ao mesmo tempo não adotam os dados duas vezes
    v_primeiro := NOT EXISTS (SELECT 1 FROM utilizadores);

    INSERT INTO utilizadores (email, nome, palavra_passe_hash) VALUES (p_email, p_nome, p_hash) RETURNING id INTO v_id;

    IF v_primeiro THEN
        UPDATE equipas SET dono_id = v_id WHERE dono_id IS NULL;
        UPDATE jogos   SET dono_id = v_id WHERE dono_id IS NULL;
    END IF;
    RETURN v_id;
END
$$;
