-- Escudos das equipas (o símbolo do clube). Cada equipa pode ter um; a imagem fica na própria base de dados
-- (já vem reduzida pelo browser: poucos KB), por isso não há pastas nem volumes a tratar.
-- Este ficheiro é idempotente: também serve para atualizar uma base de dados já existente
-- (o docker compose corre-o sozinho em cada arranque; ver o serviço "migrar").

CREATE TABLE IF NOT EXISTS escudos (
    equipa_id     INT         PRIMARY KEY REFERENCES equipas (id) ON DELETE CASCADE,
    tipo          VARCHAR(20) NOT NULL CHECK (tipo IN ('image/png', 'image/jpeg', 'image/webp')),
    dados         BYTEA       NOT NULL CHECK (octet_length(dados) BETWEEN 1 AND 204800),   -- no máximo 200 KB
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- "Versão" do escudo de uma equipa (milissegundos da última alteração), ou NULL se a equipa não tem escudo.
-- Vai no endereço da imagem (?v=...): quando o escudo muda, o endereço muda e o browser vai buscar o novo.
CREATE OR REPLACE FUNCTION escudo_versao(p_equipa_id INT) RETURNS BIGINT
LANGUAGE sql STABLE AS $$
    SELECT (EXTRACT(EPOCH FROM atualizado_em) * 1000)::BIGINT FROM escudos WHERE equipa_id = p_equipa_id
$$;
