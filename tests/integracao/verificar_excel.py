#!/usr/bin/env python3
"""Verifica os ficheiros .xlsx descarregados da API real pelo teste de integração.

    python3 tests/integracao/verificar_excel.py tests/resultados

Precisa de: pip install openpyxl. Sai com código 1 se alguma verificação falhar.
Os números esperados são os dos dados de exemplo (db/init/04_demo_eventos.sql, jogo 2).
"""
import sys
from pathlib import Path

import openpyxl

pasta = Path(sys.argv[1] if len(sys.argv) > 1 else "tests/resultados")
falhas = []
total = 0


def ok(condicao, mensagem, detalhe=""):
    global total
    total += 1
    print(("OK    " if condicao else "FALHA ") + mensagem + ("" if condicao or not detalhe else f"  -> {detalhe}"))
    if not condicao:
        falhas.append(f"{mensagem} ({detalhe})" if detalhe else mensagem)


def linhas(livro, folha):
    """Linhas da folha sem as completamente vazias."""
    return [l for l in livro[folha].iter_rows(values_only=True) if any(c is not None for c in l)]


def tabela(livro, folha):
    """Folha com cabeçalho na 1.ª linha -> lista de dicionários."""
    todas = linhas(livro, folha)
    cab = todas[0]
    return [dict(zip(cab, l)) for l in todas[1:]]


def abrir(nome):
    caminho = pasta / nome
    ok(caminho.exists(), f"{nome} existe", str(caminho))
    if not caminho.exists():
        return None
    try:
        return openpyxl.load_workbook(caminho)  # falha se o ZIP/XML estiver mal formado
    except Exception as erro:  # noqa: BLE001
        ok(False, f"{nome} abre-se com o openpyxl", repr(erro))
        return None


FOLHAS = ["Resumo", "Jogadores", "Por posição", "Por corredor", "Por distância", "Por parte",
          "Guarda-redes", "Defesas na baliza", "Outros eventos", "Eventos"]

ZONAS = ["Alto à esquerda", "Alto ao centro", "Alto à direita", "Meio à esquerda", "Meio ao centro", "Meio à direita",
         "Baixo à esquerda", "Baixo ao centro", "Baixo à direita"]

# ----------------------------------------------------------------------------- jogo completo
jogo = abrir("jogo-2.xlsx")
if jogo:
    ok(jogo.sheetnames == FOLHAS, "jogo-2.xlsx: folhas na ordem esperada", str(jogo.sheetnames))

    resumo = linhas(jogo, "Resumo")
    cabecalho = {l[0]: l[1] for l in resumo if l[0] and l[1] is not None and not isinstance(l[1], (int, float))}
    ok(resumo[0][0] == "Estatísticas do jogo", "Resumo: título", str(resumo[0]))
    ok("Águias do Norte" in str(resumo[1][0]) and "Leões do Sul" in str(resumo[1][0]), "Resumo: nomes das equipas", str(resumo[1]))
    ok(cabecalho.get("Resultado") == "6 – 9", "Resumo: resultado 6 – 9", str(cabecalho.get("Resultado")))
    ok(cabecalho.get("Âmbito") == "Jogo completo", "Resumo: âmbito = Jogo completo", str(cabecalho.get("Âmbito")))

    equipas = {l[0]: l for l in resumo if l[0] in ("Águias do Norte", "Leões do Sul") and isinstance(l[2], (int, float))}
    # colunas: Equipa, Casa/Fora, Remates, Golos, Defesas, Fora, Poste, Bloqueados, Eficácia, ...
    aguias, leoes = equipas.get("Águias do Norte"), equipas.get("Leões do Sul")
    ok(aguias is not None and aguias[2] == 17 and aguias[3] == 6, "Resumo: Águias 17 remates e 6 golos", str(aguias))
    ok(leoes is not None and leoes[2] == 16 and leoes[3] == 9, "Resumo: Leões 16 remates e 9 golos", str(leoes))
    ok(aguias is not None and abs(aguias[8] - 35.3) < 0.06, "Resumo: eficácia das Águias 35,3 %", str(aguias and aguias[8]))
    ok(leoes is not None and abs(leoes[8] - 56.3) < 0.06, "Resumo: eficácia dos Leões 56,3 %", str(leoes and leoes[8]))

    jogadores = tabela(jogo, "Jogadores")
    ok(len(jogadores) == 16, "Jogadores: 16 linhas (8 + 8)", str(len(jogadores)))
    ok(all(j["Convocado"] == "Sim" for j in jogadores), "Jogadores: todos convocados")
    ok(sum(j["Golos"] for j in jogadores) == 15, "Jogadores: soma dos golos = 15", str(sum(j["Golos"] for j in jogadores)))
    ok(sum(j["Remates"] for j in jogadores) == 33, "Jogadores: soma dos remates = 33", str(sum(j["Remates"] for j in jogadores)))

    corredores = [l for l in tabela(jogo, "Por corredor") if l["Equipa"] == "Leões do Sul"]
    ok(sum(l["Remates"] for l in corredores) == 16 and sum(l["Golos"] for l in corredores) == 9,
       "Por corredor: Leões somam 16 remates e 9 golos", str(corredores))
    pontas = [l for l in corredores if "Ponta" in str(l["Corredor"])]
    ok(sum(l["Remates"] for l in pontas) == 5 and sum(l["Golos"] for l in pontas) == 3,
       "Por corredor: pontas dos Leões 3/5", str(pontas))

    partes = tabela(jogo, "Por parte")
    ok(sum(l["Remates"] for l in partes) == 33, "Por parte: 33 remates no total", str(partes))
    distancias = tabela(jogo, "Por distância")
    ok(sum(l["Remates"] for l in distancias) == 33, "Por distância: 33 remates no total", str(distancias))
    posicoes = tabela(jogo, "Por posição")
    ok(sum(l["Remates"] for l in posicoes) == 33, "Por posição: 33 remates no total", str(posicoes))

    grs = tabela(jogo, "Guarda-redes")
    ok(len(grs) == 4, "Guarda-redes: 4 linhas (2 guarda-redes por equipa tiveram remates)", str(len(grs)))
    ok(all(g["Defesas"] + g["Golos sofridos"] == g["Remates à baliza"] for g in grs),
       "Guarda-redes: defesas + golos sofridos = remates à baliza em cada linha", str(grs))
    ok(sum(g["Golos sofridos"] for g in grs) == 15, "Guarda-redes: 15 golos sofridos no total (os 15 golos do jogo)", str(grs))

    # Defesas na baliza: uma linha por guarda-redes, uma coluna por zona (os dados de exemplo têm 11 defesas, todas com local)
    baliza = [l for l in tabela(jogo, "Defesas na baliza") if l.get("Nº") is not None]
    ok(list(tabela(jogo, "Defesas na baliza")[0].keys())[:3 + 9 + 2] == ["Equipa", "Nº", "Nome", *ZONAS, "Sem local", "Total de defesas"],
       "Defesas na baliza: cabeçalho com as 9 zonas", str(list(tabela(jogo, "Defesas na baliza")[0].keys())))
    ok(len(baliza) == 4, "Defesas na baliza: 4 linhas (os 4 guarda-redes que defenderam)", str(len(baliza)))
    ok(sum(b["Total de defesas"] for b in baliza) == 11, "Defesas na baliza: 11 defesas no total", str(baliza))
    ok(all(sum(b[z] for z in ZONAS) + b["Sem local"] == b["Total de defesas"] for b in baliza),
       "Defesas na baliza: zonas + sem local = total em cada guarda-redes", str(baliza))
    ok(all(b["Sem local"] == 0 for b in baliza), "Defesas na baliza: nos dados de exemplo todas as defesas têm local", str(baliza))
    por_zona = [sum(b[z] for b in baliza) for z in ZONAS]
    ok(por_zona == [1, 1, 1, 1, 3, 1, 1, 1, 1], "Defesas na baliza: totais por zona dos dados de exemplo", str(por_zona))
    defesas_gr = {(g["Equipa"], g["Nome"]): g["Defesas"] for g in grs}
    defesas_baliza = {(b["Equipa"], b["Nome"]): b["Total de defesas"] for b in baliza}
    ok(defesas_gr == defesas_baliza, "Defesas na baliza: coincide com as defesas da folha Guarda-redes",
       f"{defesas_gr} != {defesas_baliza}")

    outros = {(l["Equipa"], l["Evento"]): l["Total"] for l in tabela(jogo, "Outros eventos")}
    ok(sum(outros.values()) == 6, "Outros eventos: 6 no total (2 faltas, 2 perdas, 1 dois minutos, 1 timeout)", str(outros))

    eventos = tabela(jogo, "Eventos")
    ok(len(eventos) == 39, "Eventos: 39 linhas (33 remates + 6 outros)", str(len(eventos)))
    ok([e["Nº"] for e in eventos] == list(range(1, 40)), "Eventos: numeração 1..39")
    ok(sum(1 for e in eventos if e["Evento"] == "Remate") == 33, "Eventos: 33 remates")
    ok(sum(1 for e in eventos if e["Resultado"] == "Golo") == 15, "Eventos: 15 golos")
    defesas = [e for e in eventos if e["Resultado"] == "Defesa"]
    ok(len(defesas) == 11 and all(e["Zona da baliza"] in ZONAS for e in defesas),
       "Eventos: as 11 defesas têm a zona da baliza", str([e["Zona da baliza"] for e in defesas]))
    ok(all(isinstance(e["Baliza X (%)"], (int, float)) and 0 <= e["Baliza X (%)"] <= 100
           and isinstance(e["Baliza Y (%)"], (int, float)) and 0 <= e["Baliza Y (%)"] <= 100 for e in defesas),
       "Eventos: coordenadas da baliza entre 0 e 100 nas defesas")
    ok(all(e["Zona da baliza"] is None and e["Baliza X (%)"] is None for e in eventos if e["Resultado"] != "Defesa"),
       "Eventos: só as defesas têm local na baliza")
    ok(all(isinstance(e["Guarda-redes"], str) and e["Guarda-redes"].startswith("#") for e in defesas),
       "Eventos: as defesas indicam o guarda-redes (#nº nome)", str([e["Guarda-redes"] for e in defesas][:3]))
    tempos = [e["Tempo"] for e in eventos]
    ok(all(isinstance(t, str) and len(t) >= 5 and t[2] == ":" for t in tempos), "Eventos: tempo no formato mm:ss", str(tempos[:3]))

    # Nenhuma célula de texto pode ser interpretada como fórmula
    perigosas = [c.coordinate for ws in jogo for linha in ws.iter_rows() for c in linha
                 if c.data_type == "f" or (isinstance(c.value, str) and c.value.startswith("="))]
    ok(not perigosas, "nenhuma célula é uma fórmula", str(perigosas[:5]))

# ----------------------------------------------------------------------------- só uma equipa
equipa = abrir("jogo-2-equipa-2.xlsx")
if equipa:
    ok(equipa.sheetnames == FOLHAS, "jogo-2-equipa-2.xlsx: mesmas folhas", str(equipa.sheetnames))
    resumo = {l[0]: l[1] for l in linhas(equipa, "Resumo") if l[0] and isinstance(l[1], str)}
    ok("Leões do Sul" in str(resumo.get("Âmbito")), "equipa: âmbito menciona os Leões do Sul", str(resumo.get("Âmbito")))
    jogadores = tabela(equipa, "Jogadores")
    ok(len(jogadores) == 8 and {j["Equipa"] for j in jogadores} == {"Leões do Sul"}, "equipa: 8 jogadores, todos dos Leões do Sul", str(len(jogadores)))
    eventos = tabela(equipa, "Eventos")
    ok(len(eventos) == 19 and {e["Equipa"] for e in eventos} == {"Leões do Sul"}, "equipa: 19 eventos, todos dos Leões do Sul", str(len(eventos)))
    corredores = tabela(equipa, "Por corredor")
    ok({l["Equipa"] for l in corredores} == {"Leões do Sul"} and sum(l["Remates"] for l in corredores) == 16,
       "equipa: por corredor só dos Leões, 16 remates", str(corredores))
    grs = tabela(equipa, "Guarda-redes")
    ok({g["Equipa"] for g in grs} == {"Leões do Sul"}, "equipa: só o guarda-redes dos Leões", str(grs))
    baliza = [l for l in tabela(equipa, "Defesas na baliza") if l.get("Nº") is not None]
    ok(len(baliza) >= 1 and {b["Equipa"] for b in baliza} == {"Leões do Sul"}, "equipa: defesas na baliza só dos guarda-redes dos Leões", str(baliza))
    ok(sum(b["Total de defesas"] for b in baliza) == sum(g["Defesas"] for g in grs), "equipa: defesas na baliza = defesas da folha Guarda-redes", str(baliza))

# ----------------------------------------------------------------------------- jogo novo, quase vazio
novo = abrir("jogo-novo.xlsx")
if novo:
    ok(novo.sheetnames == FOLHAS, "jogo-novo.xlsx: mesmas folhas", str(novo.sheetnames))
    eventos = tabela(novo, "Eventos")
    ok(len(eventos) >= 1, "jogo novo: tem os eventos registados no teste", str(len(eventos)))
    # o teste de integração registou 2 defesas ao "GR B": uma em baixo à direita (83,5 / 91,2) e outra sem local
    defesas = [e for e in eventos if e["Resultado"] == "Defesa"]
    ok(len(defesas) == 2, "jogo novo: 2 defesas registadas", str(len(defesas)))
    com_local = [e for e in defesas if e["Zona da baliza"] is not None]
    ok(len(com_local) == 1 and com_local[0]["Zona da baliza"] == "Baixo à direita"
       and abs(com_local[0]["Baliza X (%)"] - 83.5) < 0.001 and abs(com_local[0]["Baliza Y (%)"] - 91.2) < 0.001,
       "jogo novo: a defesa com local aparece em 'Baixo à direita' (83,5 / 91,2)", str(com_local))
    ok(sum(1 for e in defesas if e["Zona da baliza"] is None and e["Baliza X (%)"] is None) == 1, "jogo novo: a outra defesa fica sem local")
    baliza = [l for l in tabela(novo, "Defesas na baliza") if l.get("Nº") is not None]
    gr_b = [b for b in baliza if b["Nome"] == "GR B"]
    ok(len(gr_b) == 1 and gr_b[0]["Baixo à direita"] == 1 and gr_b[0]["Sem local"] == 1 and gr_b[0]["Total de defesas"] == 2,
       "jogo novo: GR B tem 1 defesa em baixo à direita e 1 sem local", str(gr_b))

print()
if falhas:
    print(f"{len(falhas)} verificação(ões) falharam:")
    for f in falhas:
        print(" -", f)
    resumo = "%0A".join(falhas[:20]).replace("\r", "")
    print(f"::error title=Verificação dos ficheiros Excel::{resumo}")
    sys.exit(1)
print(f"Todas as {total} verificações dos ficheiros Excel passaram.")
