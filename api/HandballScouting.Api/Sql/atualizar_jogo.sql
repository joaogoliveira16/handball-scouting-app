-- O dono corrige um jogo seu: as equipas (casa e fora), a data e hora (sem data fica a que estava) e o local.
-- Devolve o jogo (nada se não for desta conta).
UPDATE jogos
SET equipa_casa_id = @casaId,
    equipa_fora_id = @foraId,
    data_hora      = COALESCE(@dataHora::timestamptz, data_hora),
    local          = @local
WHERE id = @jogoId AND dono_id = @donoId
RETURNING id;
