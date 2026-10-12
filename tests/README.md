# Testes de integração e de browser

Testes que usam a **API verdadeira** (ASP.NET Core + PostgreSQL), ao contrário dos testes xUnit de `api/HandballScouting.Tests`, que testam código isolado. Correm no CI (job *Integração*), mas também podes corrê-los no teu computador.

| Ficheiro | O que faz |
|----------|-----------|
| `integracao/integracao.mjs` | Chama a API por HTTP e SignalR: contas (registo, entrada, saída, sessão por cookie, travão de tentativas), isolamento entre duas contas, link de partilha (`?c=`) para ver o jogo sem conta, estatísticas dos dados de exemplo, equipas, jogadores, novo jogo, convocatória, eventos, local das defesas na baliza, atualizações em tempo real e descarga do Excel. Guarda os `.xlsx` em `resultados/`. |
| `integracao/verificar_excel.py` | Abre os `.xlsx` guardados (openpyxl) e confere folhas, totais e filtros por equipa. |
| `e2e/fluxos.mjs` | Abre as páginas num Chromium (Playwright) e usa-as como um utilizador: cria a conta, sai e entra, trata do plantel e da convocatória, regista remates no banco (incluindo a janela da baliza ao tocar em Defesa) e confirma que o dashboard recebe o golo e as defesas por WebSocket, também para quem só tem o link de partilha (outro browser, sem sessão). Uma segunda conta confirma que não vê nada da primeira. |
| `e2e/servidor.mjs` | Faz o papel do nginx: serve `frontend/` e reencaminha `/api` e `/hub` (incluindo WebSockets) para a API. |
| `api.sh` | Publica e arranca a API em `http://localhost:5080` (usado pelo CI). |

## Correr localmente

Precisas de .NET 8, Node 22, PostgreSQL e Python 3 com `openpyxl`.

Os testes criam contas novas (emails com um sufixo aleatório). A **primeira conta** de uma base de dados herda os dados de exemplo, por isso a base de dados tem de estar **acabada de criar** (passo 1): é isso que dá à conta de teste os jogos de exemplo.

```bash
# 1. Base de dados limpa com os dados de exemplo
export PGHOST=localhost PGUSER=scouting PGPASSWORD=scouting PGDATABASE=scouting
for f in db/init/*.sql; do psql -v ON_ERROR_STOP=1 -q -f "$f"; done

# 2. API em http://localhost:5080
tests/api.sh arrancar

# 3. Dependências (uma vez) e testes
cd tests
npm ci
node integracao/integracao.mjs
python3 integracao/verificar_excel.py resultados

# 4. Testes de browser: precisam de uma base de dados limpa, sem contas (repete o passo 1 com a API parada)
npx playwright install chromium
node e2e/fluxos.mjs

# no fim
./api.sh parar
```

Os testes **criam dados** (equipas, jogadores, jogos), por isso não os corras contra a base de dados com os teus jogos reais. Os ficheiros gerados (`.xlsx`, capturas de ecrã, `api.log`) ficam em `tests/resultados/`.

Variáveis: `API_URL` (por defeito `http://localhost:5080`), `EXCEL_DIR` e `E2E_DIR` (onde guardar os ficheiros, por defeito `./resultados`) e as variáveis `PG*` habituais para os testes de browser, que também confirmam o que ficou na base de dados.
