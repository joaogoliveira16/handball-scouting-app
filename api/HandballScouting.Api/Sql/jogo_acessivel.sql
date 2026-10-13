-- Pode ver o jogo? Sim se for o dono (sessão), se tiver o código do link de partilha, ou se o jogo estiver aberto
-- a todos (o dono não o escondeu e o último evento, ou a data do jogo se não há eventos, está a menos de minutosAberto
-- minutos de agora). Qualquer outro caso = não existe.
SELECT EXISTS (
    SELECT 1 FROM jogos
    WHERE id = @jogoId
      AND (dono_id = @utilizadorId::int
           OR codigo = @codigo::text
           OR jogo_aberto_a_convidados(id, @minutosAberto))
);
