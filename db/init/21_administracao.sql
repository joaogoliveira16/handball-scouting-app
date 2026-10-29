-- Administração: quem administra a app, contas desativadas e o registo de alterações.
-- Este ficheiro é idempotente: também serve para atualizar uma base de dados já existente
-- (o docker compose corre-o sozinho em cada arranque; ver o serviço "migrar").
--
-- Regras:
--   * utilizadores.papel: 'normal' (por omissão) ou 'admin'. Quem é admin pode ver todas as contas e jogos, corrigir
--     eventos de qualquer jogo, desativar contas e pedir a recuperação da palavra-passe de uma conta. O primeiro admin
--     define-se na configuração da API (Administracao__Emails, ver o README), nunca pelo registo público.
--   * utilizadores.desativado_em: quando a conta foi desativada (NULL = ativa). Uma conta desativada não entra e as
--     sessões que tinha deixam de servir; os dados dela (equipas, jogos, eventos) ficam como estavam.
--   * registo_alteracoes: uma linha por ação de um admin (contas e eventos de jogos), para se saber quem mudou o quê e
--     quando. O nome de quem fez a ação fica copiado na linha, por isso o registo sobrevive a uma conta apagada.

ALTER TABLE utilizadores ADD COLUMN IF NOT EXISTS papel VARCHAR(10) NOT NULL DEFAULT 'normal'
    CONSTRAINT utilizadores_papel_valido CHECK (papel IN ('normal', 'admin'));

ALTER TABLE utilizadores ADD COLUMN IF NOT EXISTS desativado_em TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS registo_alteracoes (
    id         BIGSERIAL    PRIMARY KEY,
    quando     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    autor_id   INT          REFERENCES utilizadores (id) ON DELETE SET NULL,
    autor_nome VARCHAR(80)  NOT NULL,                 -- cópia do nome de quem fez a ação
    tipo       VARCHAR(10)  NOT NULL CHECK (tipo IN ('conta', 'evento')),
    acao       VARCHAR(60)  NOT NULL,
    detalhe    TEXT         NOT NULL DEFAULT '',
    jogo_id    INT                                    -- o jogo a que a ação diz respeito (sem chave: o jogo pode ser apagado depois)
);
CREATE INDEX IF NOT EXISTS ix_registo_alteracoes_quando ON registo_alteracoes (quando DESC, id DESC);
