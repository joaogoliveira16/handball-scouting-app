-- Pode ver o jogo: é o dono (sessão) ou tem o código do link de partilha. Qualquer outro caso = não existe.
SELECT EXISTS (
    SELECT 1 FROM jogos
    WHERE id = @jogoId
      AND (dono_id = @utilizadorId::int OR codigo = @codigo::text)
);
