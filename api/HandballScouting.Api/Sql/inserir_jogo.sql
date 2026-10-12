INSERT INTO jogos (equipa_casa_id, equipa_fora_id, data_hora, local, dono_id)
VALUES (@casaId, @foraId, COALESCE(@dataHora::timestamptz, now()), @local, @donoId)
RETURNING id;
