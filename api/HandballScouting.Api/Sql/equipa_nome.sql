-- O nome de uma equipa da conta (vazio se a equipa não existe ou é de outra conta).
SELECT nome FROM equipas WHERE id = @equipaId AND dono_id = @donoId;
