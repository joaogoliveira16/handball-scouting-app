-- Confirmação do email: uma conta nova só entra depois de abrir o link que lhe foi enviado por email.
-- Este ficheiro é idempotente: também serve para atualizar uma base de dados já existente
-- (o docker compose corre-o sozinho em cada arranque; ver o serviço "migrar").
--
-- Regras:
--   * utilizadores.email_verificado_em: quando o email foi confirmado (NULL = ainda por confirmar).
--     As contas que já existiam quando este ficheiro correu pela primeira vez ficam confirmadas.
--   * verificacoes_email: o link do email leva um código aleatório; aqui só fica o seu SHA-256 e a validade.
--   * A primeira conta com o email confirmado fica com tudo o que ainda não tem dono (incluindo os dados
--     de exemplo, que passam a ser equipas adversárias da conta). Assim um registo com um email errado, que nunca chega a ser confirmado, não leva nada.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'utilizadores' AND column_name = 'email_verificado_em'
    ) THEN
        ALTER TABLE utilizadores ADD COLUMN email_verificado_em TIMESTAMPTZ;
        UPDATE utilizadores SET email_verificado_em = criado_em;   -- contas anteriores: já estavam em uso
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS verificacoes_email (
    token_hash    CHAR(64)    PRIMARY KEY,          -- SHA-256 (hex) do código que vai no link do email
    utilizador_id INT         NOT NULL REFERENCES utilizadores (id) ON DELETE CASCADE,
    criada_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expira_em     TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_verificacoes_utilizador ON verificacoes_email (utilizador_id);

-- ---------------------------------------------------------------------
-- Marca o email de uma conta como confirmado (se ainda não estava). A primeira conta confirmada adota as
-- equipas e os jogos que ainda não têm dono. Devolve FALSE se a conta não existe. Repetir não muda nada.
-- Usada ao abrir o link de confirmação e ao redefinir a palavra-passe (o link também prova que o email é da pessoa).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marcar_email_confirmado(p_id INT) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
    v_ja       BOOLEAN;
    v_primeiro BOOLEAN;
BEGIN
    LOCK TABLE utilizadores IN SHARE ROW EXCLUSIVE MODE;   -- duas primeiras contas ao mesmo tempo não adotam os dados duas vezes
    SELECT email_verificado_em IS NOT NULL INTO v_ja FROM utilizadores WHERE id = p_id;
    IF v_ja IS NULL THEN
        RETURN FALSE;   -- a conta não existe (foi apagada entretanto)
    END IF;

    IF NOT v_ja THEN
        v_primeiro := NOT EXISTS (SELECT 1 FROM utilizadores WHERE email_verificado_em IS NOT NULL AND id <> p_id);
        UPDATE utilizadores SET email_verificado_em = now() WHERE id = p_id;
        IF v_primeiro THEN
            -- o nome da equipa é único por conta: se a equipa que a conta criou ao registar-se tem o nome de uma
            -- equipa de exemplo, esta passa a chamar-se «(exemplo)» antes de ser adotada
            UPDATE equipas SET nome = nome || ' (exemplo)'
            WHERE dono_id IS NULL AND nome IN (SELECT nome FROM equipas WHERE dono_id = p_id);
            UPDATE equipas SET dono_id = p_id WHERE dono_id IS NULL;
            UPDATE jogos   SET dono_id = p_id WHERE dono_id IS NULL;
        END IF;
    END IF;
    RETURN TRUE;
END
$$;

-- ---------------------------------------------------------------------
-- Confirmar o email a partir do SHA-256 do código do link. Devolve o id da conta, ou NULL se o código
-- não existe ou já expirou. Repetir com o mesmo código (link aberto duas vezes) continua a dar o id.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION confirmar_email(p_token_hash TEXT) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
    v_id INT;
BEGIN
    SELECT utilizador_id INTO v_id FROM verificacoes_email WHERE token_hash = p_token_hash AND expira_em > now();
    IF v_id IS NULL OR NOT marcar_email_confirmado(v_id) THEN
        RETURN NULL;
    END IF;
    RETURN v_id;
END
$$;
