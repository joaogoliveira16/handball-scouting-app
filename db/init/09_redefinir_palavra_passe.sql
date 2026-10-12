-- Recuperação da palavra-passe: quem a esqueceu pede um link por email e escolhe outra.
-- Este ficheiro é idempotente: também serve para atualizar uma base de dados já existente
-- (o docker compose corre-o sozinho em cada arranque; ver o serviço "migrar").
--
-- Regras:
--   * redefinicoes_palavra_passe: o link do email leva um código aleatório; aqui só fica o seu SHA-256 e a validade.
--   * Um link só funciona uma vez: ao usá-lo apagam-se todos os códigos da conta.
--   * Mudar a palavra-passe termina todas as sessões da conta (quem lha tivesse roubado deixa de entrar).
--   * O link chegou ao email da pessoa, por isso também confirma o email (ver marcar_email_confirmado, em 08).

CREATE TABLE IF NOT EXISTS redefinicoes_palavra_passe (
    token_hash    CHAR(64)    PRIMARY KEY,          -- SHA-256 (hex) do código que vai no link do email
    utilizador_id INT         NOT NULL REFERENCES utilizadores (id) ON DELETE CASCADE,
    criada_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expira_em     TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_redefinicoes_utilizador ON redefinicoes_palavra_passe (utilizador_id);

-- ---------------------------------------------------------------------
-- Escolher a palavra-passe nova a partir do SHA-256 do código do link (p_hash é o hash da palavra-passe nova,
-- feito pela API). Devolve o id da conta, ou NULL se o código não existe, já expirou ou já foi usado.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION redefinir_palavra_passe(p_token_hash TEXT, p_hash TEXT) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
    v_id INT;
BEGIN
    -- FOR UPDATE: se o mesmo link for usado duas vezes ao mesmo tempo, só um dos pedidos o encontra
    SELECT utilizador_id INTO v_id
    FROM redefinicoes_palavra_passe
    WHERE token_hash = p_token_hash AND expira_em > now()
    FOR UPDATE;
    IF v_id IS NULL THEN
        RETURN NULL;
    END IF;

    DELETE FROM redefinicoes_palavra_passe WHERE utilizador_id = v_id;
    IF NOT marcar_email_confirmado(v_id) THEN
        RETURN NULL;
    END IF;

    UPDATE utilizadores SET palavra_passe_hash = p_hash WHERE id = v_id;
    DELETE FROM sessoes WHERE utilizador_id = v_id;
    RETURN v_id;
END
$$;
