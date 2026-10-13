-- Segundo de jogo do evento mais recente (0 se o jogo ainda não tem eventos ou se o relógio nunca foi usado)
SELECT COALESCE(MAX(segundo_jogo), 0) AS segundo
FROM eventos
WHERE jogo_id = @jogoId;
