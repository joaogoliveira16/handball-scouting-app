-- A imagem do escudo de uma equipa (não devolve nada se a equipa não tem escudo)
SELECT tipo, dados, escudo_versao(equipa_id) AS versao
FROM escudos
WHERE equipa_id = @equipaId;
