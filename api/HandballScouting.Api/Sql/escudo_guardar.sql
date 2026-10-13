-- Guarda (ou troca) o escudo de uma equipa e devolve a versão nova (a mesma conta que escudo_versao faz: milissegundos).
-- Calculada aqui e não com escudo_versao(): uma função STABLE não vê a linha que esta mesma instrução acabou de gravar.
INSERT INTO escudos (equipa_id, tipo, dados) VALUES (@equipaId, @tipo, @dados)
ON CONFLICT (equipa_id) DO UPDATE SET tipo = EXCLUDED.tipo, dados = EXCLUDED.dados, atualizado_em = clock_timestamp()
RETURNING (EXTRACT(EPOCH FROM atualizado_em) * 1000)::BIGINT;
