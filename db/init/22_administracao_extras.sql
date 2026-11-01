-- Administração, segunda parte: editar o nome e o email de uma conta, terminar/reabrir/apagar jogos de outras contas
-- e ver quando cada conta entrou pela última vez.
-- Este ficheiro é idempotente: também serve para atualizar uma base de dados já existente
-- (o docker compose corre-o sozinho em cada arranque; ver o serviço "migrar").
--
-- Regras:
--   * utilizadores.ultimo_acesso_em: a última vez que a conta usou a app (NULL = nunca entrou desde esta versão).
--     A API atualiza-o no máximo uma vez por hora, quando uma sessão da conta é usada.
--   * registo_alteracoes.tipo passa a aceitar 'jogo': terminar, reabrir ou apagar um jogo de outra conta.

ALTER TABLE utilizadores ADD COLUMN IF NOT EXISTS ultimo_acesso_em TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'registo_alteracoes'::regclass
          AND conname = 'registo_alteracoes_tipo_check'
          AND pg_get_constraintdef(oid) LIKE '%jogo%'
    ) THEN
        ALTER TABLE registo_alteracoes DROP CONSTRAINT IF EXISTS registo_alteracoes_tipo_check;
        ALTER TABLE registo_alteracoes ADD CONSTRAINT registo_alteracoes_tipo_check CHECK (tipo IN ('conta', 'evento', 'jogo'));
    END IF;
END
$$;
