INSERT INTO jogos (equipa_casa_id, equipa_fora_id, data_hora, local)
VALUES (@casaId, @foraId, COALESCE(@dataHora::timestamptz, now()), @local)
RETURNING id;
