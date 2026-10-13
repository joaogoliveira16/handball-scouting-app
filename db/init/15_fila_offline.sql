-- Modo sem rede: o tablet do banco guarda os eventos quando não há rede e envia-os quando ela volta.
-- Este ficheiro é idempotente: também serve para atualizar uma base de dados já existente
-- (o docker compose corre-o sozinho em cada arranque; ver o serviço "migrar").
--
-- Cada evento criado pelo banco leva um identificador gerado no tablet (cliente_id). Se o envio for repetido
-- (a resposta perdeu-se, o tablet voltou a tentar), a base de dados reconhece-o e não regista o evento duas vezes.
-- Os eventos antigos e os criados por outros meios ficam sem identificador (NULL), que o índice ignora.

ALTER TABLE eventos ADD COLUMN IF NOT EXISTS cliente_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS ux_eventos_cliente ON eventos (jogo_id, cliente_id) WHERE cliente_id IS NOT NULL;
