-- Uma equipa por conta: cada conta tem a sua equipa (escolhida ao criar a conta). É a única que aparece na página
-- das equipas; os adversários são equipas da mesma conta que só se veem nos jogos (e na convocatória).
-- Este ficheiro é idempotente: também serve para atualizar uma base de dados já existente
-- (o docker compose corre-o sozinho em cada arranque; ver o serviço "migrar").
--
-- Regras:
--   * utilizadores.equipa_id: a equipa da conta (NULL = ainda não tem; a página das equipas pede-a).
--     As contas que já existiam ficam com a primeira equipa que já tinham (a de menor id); as outras
--     passam a ser adversárias e continuam nos jogos que já tinham.
--   * Criar uma conta com o nome da equipa cria também essa equipa e guarda-a como a equipa da conta.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'utilizadores' AND column_name = 'equipa_id'
    ) THEN
        ALTER TABLE utilizadores ADD COLUMN equipa_id INT REFERENCES equipas (id);
        UPDATE utilizadores u SET equipa_id = (SELECT MIN(e.id) FROM equipas e WHERE e.dono_id = u.id);
    END IF;
END
$$;

-- ---------------------------------------------------------------------
-- Criar uma conta com a sua equipa (ainda por confirmar: ver 08_confirmacao_email.sql). Devolve o id da conta nova.
-- Um email repetido dá unique_violation e não fica nada criado (a API responde 409).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION registar_utilizador(p_email TEXT, p_nome TEXT, p_hash TEXT, p_equipa TEXT) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
    v_id     INT;
    v_equipa INT;
BEGIN
    IF btrim(COALESCE(p_equipa, '')) = '' THEN
        RAISE EXCEPTION 'o nome da equipa não pode ficar vazio' USING ERRCODE = 'check_violation';
    END IF;
    v_id := registar_utilizador(p_email, p_nome, p_hash);
    INSERT INTO equipas (nome, dono_id) VALUES (btrim(p_equipa), v_id) RETURNING id INTO v_equipa;
    UPDATE utilizadores SET equipa_id = v_equipa WHERE id = v_id;
    RETURN v_id;
END
$$;
