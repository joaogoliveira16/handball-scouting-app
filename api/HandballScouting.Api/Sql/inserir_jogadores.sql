-- Vários jogadores novos de uma vez (a lista lida de uma foto), pela ordem em que vêm. Um número que a equipa já
-- tem, ou que um jogador anterior do mesmo lote já usou, fica de fora: devolve só os que entraram.
INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo)
SELECT @equipaId, l.numero, l.nome, l.posicao
FROM unnest(@numeros::int[], @nomes::text[], @posicoes::text[]) WITH ORDINALITY AS l (numero, nome, posicao, ordem)
ORDER BY l.ordem
ON CONFLICT (equipa_id, numero) DO NOTHING
RETURNING id, numero;
