-- Jogadores com 2 minutos ou vermelho no jogo; "expulso" = vermelho direto ou 3 vezes 2 minutos (ver v_sancoes)
SELECT jogador_id, equipa_id, numero, nome, dois_minutos, vermelhos, expulso
FROM v_sancoes
WHERE jogo_id = @jogoId
ORDER BY equipa_id, numero;
