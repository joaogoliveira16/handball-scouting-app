# Testes de integração, de browser e do frontend

Testes que usam a **API verdadeira** (ASP.NET Core + PostgreSQL), ao contrário dos testes xUnit de `api/HandballScouting.Tests`, que testam código isolado. Correm no CI (job *Integração*), mas também podes corrê-los no teu computador.

| Ficheiro | O que faz |
|----------|-----------|
| `unidade/*.test.mjs` | Testes unitários do frontend, sem browser nem API (`npm run unidade`, usa o `node --test`): `lista-jogadores.test.mjs` confere a leitura das listas de jogadores a partir do texto que o OCR devolve (texto lido de verdade pelo Tesseract em fichas de jogo, listas e prints de chat; números trocados por letras, cabeçalhos, horas, duplicados, nomes em maiúsculas). |
| `integracao/integracao.mjs` | Chama a API por HTTP e SignalR: contas (registo, email de confirmação lido na caixa de correio de teste, confirmar pelo link, reenviar, entrada bloqueada até confirmar, saída, sessão por cookie, travão de tentativas), recuperação da palavra-passe (email com o link, código de uso único, sessões terminadas, palavra-passe antiga deixa de servir, link reutilizado ou inventado recusado, travão de pedidos), a equipa da conta (pedida no registo, `propria` na lista de equipas, adversários), jogos abertos a convidados durante 24 horas (lista aberta sem sessão, resultado, sem o código de partilha, jogos sem eventos pela hora marcada, jogos de há 3 dias e de daqui a 2 dias fora da lista, acesso sem link, esconder o jogo só pelo dono), isolamento entre duas contas, link de partilha (`?c=`) para ver o jogo sem conta, estatísticas dos dados de exemplo, equipas, jogadores, novo jogo, convocatória, eventos, local das defesas na baliza, atualizações em tempo real e descarga do Excel. Guarda os `.xlsx` em `resultados/`. |
| `integracao/verificar_excel.py` | Abre os `.xlsx` guardados (openpyxl) e confere folhas, totais e filtros por equipa. |
| `e2e/fluxos.mjs` | Abre as páginas num Chromium (Playwright) e usa-as como um utilizador: cria a conta, sai e entra, trata do plantel e da convocatória, regista remates no banco (incluindo a janela da baliza ao tocar em Defesa) e confirma que o dashboard recebe o golo e as defesas por WebSocket, também para quem só tem o link de partilha (outro browser, sem sessão). Também testa o email de confirmação (link no email, «Reenviar email», link inválido), a recuperação da palavra-passe (pedir o link na página de entrada, abrir o do email, escolher a nova, entrar com ela, link usado a segunda vez) e a leitura da lista de uma foto na convocatória (desenha uma ficha de jogo, lê-a com o leitor verdadeiro, confere os jogadores lidos, corrige à mão, confirma e verifica a base de dados; uma imagem em branco e «Cancelar» não mudam nada), e a página que só mostra a equipa da conta (e um adversário aberto pelo URL), criar um jogo escrevendo o adversário (reaproveita o que já existe), a área de convidado (lista de jogos das últimas 24 horas com resultado e hora do último evento, jogos sem eventos pela hora marcada, abrir o jogo sem link nem botão de partilha, o dono esconder e voltar a mostrar o jogo, ainda aberto às 23 horas e só com link às 25; colar o link, lista de jogos neste dispositivo). Uma segunda conta confirma que não vê nada da primeira. |
| `e2e/servidor.mjs` | Faz o papel do nginx: serve `frontend/` e reencaminha `/api` e `/hub` (incluindo WebSockets) para a API. |
| `correio.mjs` | Lê os emails da caixa de correio de teste (API HTTP do Mailpit) e tira deles o código do link de confirmação ou de recuperação da palavra-passe. |
| `api.sh` | Publica e arranca a API em `http://localhost:5080`, a enviar emails para o Mailpit em `localhost:1025` (usado pelo CI). |

## Correr localmente

Precisas de .NET 8, Node 22, PostgreSQL, Python 3 com `openpyxl` e uma caixa de correio de teste (Mailpit) para os emails de confirmação: `docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit:v1.21`.

Os testes criam contas novas (emails com um sufixo aleatório). A **primeira conta confirmada** de uma base de dados herda os dados de exemplo, por isso a base de dados tem de estar **acabada de criar** (passo 1): é isso que dá à conta de teste os jogos de exemplo.

```bash
# 1. Base de dados limpa com os dados de exemplo
export PGHOST=localhost PGUSER=scouting PGPASSWORD=scouting PGDATABASE=scouting
for f in db/init/*.sql; do psql -v ON_ERROR_STOP=1 -q -f "$f"; done

# 2. API em http://localhost:5080
tests/api.sh arrancar

# 3. Dependências (uma vez) e testes
cd tests
npm ci
npm run unidade
node integracao/integracao.mjs
python3 integracao/verificar_excel.py resultados

# 4. Testes de browser: precisam de uma base de dados limpa, sem contas (repete o passo 1 com a API parada)
npx playwright install chromium
node e2e/fluxos.mjs

# no fim
./api.sh parar
```

Os testes **criam dados** (equipas, jogadores, jogos), por isso não os corras contra a base de dados com os teus jogos reais. Os ficheiros gerados (`.xlsx`, capturas de ecrã, `api.log`) ficam em `tests/resultados/`.

Variáveis: `API_URL` (por defeito `http://localhost:5080`), `EMAIL_API` (a API HTTP do Mailpit, por defeito `http://localhost:8025`), `EXCEL_DIR` e `E2E_DIR` (onde guardar os ficheiros, por defeito `./resultados`) e as variáveis `PG*` habituais para os testes de browser, que também confirmam o que ficou na base de dados.
