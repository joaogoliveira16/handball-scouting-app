#!/usr/bin/env python3
"""Valida as consultas de api/HandballScouting.Api/Sql contra o esquema real.

Converte os parâmetros @nome em $1, $2... e faz PREPARE de cada consulta: o PostgreSQL
verifica a sintaxe, as tabelas, as colunas e os tipos sem executar nada.
Usa as variáveis PGHOST, PGUSER, PGPASSWORD e PGDATABASE (como o psql).

    python3 db/tests/validar_consultas.py
"""
import pathlib
import re
import subprocess
import sys

PASTA = pathlib.Path(__file__).resolve().parents[2] / "api" / "HandballScouting.Api" / "Sql"
# substituir_convocados.sql tem duas instruções e o PREPARE só aceita uma (é testado no teste de integração).
# Listas de ids usam "= ANY(@ids)": o Npgsql envia a lista como um array do PostgreSQL (o "IN @ids" que o
# Dapper expande para (@ids1, @ids2...) não funciona com o Npgsql).
IGNORAR = {"substituir_convocados.sql"}

erros = 0
for ficheiro in sorted(PASTA.glob("*.sql")):
    if ficheiro.name in IGNORAR:
        continue
    sem_comentarios = "\n".join(l for l in ficheiro.read_text(encoding="utf-8").splitlines() if not l.strip().startswith("--"))
    posicoes = {}

    def numerar(m):
        return f"${posicoes.setdefault(m.group(1).lower(), len(posicoes) + 1)}"

    consulta = re.sub(r"@(\w+)", numerar, sem_comentarios).rstrip().rstrip(";")
    script = f"PREPARE q AS\n{consulta};\n"
    r = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"], input=script, text=True, capture_output=True)
    if r.returncode == 0:
        print(f"OK    {ficheiro.name}")
    else:
        erros += 1
        print(f"ERRO  {ficheiro.name}\n{r.stderr.strip()}")

print(f"\n{'Todas as consultas são válidas.' if erros == 0 else f'{erros} consulta(s) com erro.'}")
sys.exit(1 if erros else 0)
