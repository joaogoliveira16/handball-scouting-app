# Testes de integração, de browser e do frontend

Testes que usam a **API verdadeira** (ASP.NET Core + PostgreSQL), ao contrário dos testes xUnit de `api/HandballScouting.Tests`, que testam código isolado. Correm no CI (job *Integração*), mas também podes corrê-los no teu computador.

| Ficheiro | O que faz |
|----------|-----------|
| `unidade/*.test.mjs` | Testes unitários do frontend, sem browser nem API (`npm run unidade`, usa o `node --test`): `fila.test.mjs` e `otimista.test.mjs` conferem a fila de eventos sem rede (ordem, reenvio, erros, armazenamento cheio) e as estatísticas otimistas do banco; `sw.test.mjs` confere que o service worker guarda tudo o que o banco e a lista de jogos carregam (módulos, estilos, letras, ícones) e que o manifest está completo; `numerica.test.mjs` confere a contagem dos 2 minutos e do 7×6 no browser (jogadores a menos, rótulo 6×5, segundo de jogo a partir do relógio do servidor); `timeout.test.mjs` confere o minuto do time-out (começa em 1:00, desconta, fica a zero à espera de retomar e desiste se for esquecido); `analise.test.mjs` confere as contas do dashboard feitas no browser (eficácia contra cada defesa do adversário, melhor e pior defesa, e o livro dos 7 metros por lançador com a zona preferida); `relatorio-intervalo.test.mjs` confere o relatório do intervalo (os números de cada parte e da equipa escolhida, uma regra de cada vez — exclusões, guarda-redes, finalização, jogadores, perdas de bola, zonas, corredor, contra-ataque, defesa do adversário —, o limite de 3 pontos a corrigir e 2 a manter por ordem de gravidade e o texto para copiar); `lista-jogadores.test.mjs` confere a leitura das listas de jogadores a partir do texto que o OCR devolve (texto lido de verdade pelo Tesseract em fichas de jogo, listas e capturas de ecrã de chat; números trocados por letras, cabeçalhos, horas, duplicados, nomes em maiúsculas). |
| `integracao/integracao.mjs` | Chama a API por HTTP e SignalR: contas (registo, email de confirmação lido na caixa de correio de teste, confirmar pela ligação, reenviar, entrada bloqueada até confirmar, saída, sessão por cookie, travão de tentativas), recuperação da palavra-passe (email com a ligação, código de uso único, sessões terminadas, palavra-passe antiga deixa de servir, ligação reutilizada ou inventada recusada, travão de pedidos), a equipa da conta (pedida no registo, `propria` na lista de equipas, adversários), jogos abertos a convidados durante 24 horas (lista aberta sem sessão, resultado, sem o código de partilha, jogos sem eventos pela hora marcada, jogos de há 3 dias e de daqui a 2 dias fora da lista, acesso sem ligação, esconder o jogo só pelo dono), isolamento entre duas contas, ligação de partilha (`?c=`) para ver o jogo sem conta, estatísticas dos dados de exemplo, equipas, jogadores, novo jogo, convocatória, eventos, sanções e expulsões, o treinador-assistente (série de golos -> time-out, direitos de time-out por parte, jogador a marcar de perto), escudos (só o dono muda, só PNG/JPEG/WebP até 200 KB, cache e versão nas listas), local das defesas e dos golos na baliza, atualizações em tempo real e descarga do Excel. Guarda os `.xlsx` em `resultados/`. |
| `integracao/verificar_excel.py` | Abre os `.xlsx` guardados (openpyxl) e confere folhas, totais e filtros por equipa. |
| `e2e/fluxos.mjs` | Abre as páginas num Chromium (Playwright) e usa-as como um utilizador: cria a conta, sai e entra, trata do plantel e da convocatória, regista remates no banco (incluindo a janela da baliza ao tocar em Defesa), expulsa jogadores no banco (contador 2′×N, 3.º 2 minutos, vermelho direto, apagar para corrigir), confere o quadro de sanções do dashboard, conta os 2 minutos no banco com o relógio a andar (faixa 6×5 com contagem decrescente, 7×6 que liga e desliga, relógio do banco no dashboard), confere a eficácia por situação no dashboard, confere as sugestões do treinador-assistente (só o dono as vê; pedir time-out no banco tira a sugestão e gasta direitos), regista **sem rede** (corta a rede do browser: golo, 2 minutos e time-out ficam na fila do tablet com o indicador «por enviar» e o marcador a contar, desfazer tira da fila, ao voltar a rede chegam por ordem e uma só vez, com a hora do toque; com o service worker a ligar, a página abre sem rede, e a lista de jogos e o banco enviam a mesma fila sem duplicar), e carrega, troca (por um SVG) e tira o escudo da equipa, que confere no marcador do banco e do dashboard, na lista de jogos, na convocatória e na área de convidado e confirma que o dashboard recebe o golo e as defesas por WebSocket, também para quem só tem a ligação de partilha (outro browser, sem sessão). Também testa o email de confirmação (ligação no email, «Reenviar email», ligação inválida), a recuperação da palavra-passe (pedir a ligação na página de entrada, abrir a do email, escolher a nova, entrar com ela, ligação usada a segunda vez) e a leitura da lista de uma foto na convocatória (desenha uma ficha de jogo, lê-a com o leitor verdadeiro, confere os jogadores lidos, corrige à mão, confirma e verifica a base de dados; uma imagem em branco e «Cancelar» não mudam nada), o relatório do intervalo (o botão do dashboard acompanha a equipa escolhida, os 3 pontos a corrigir e o ponto a manter, os números só da 1.ª parte, a outra equipa e a 2.ª parte, copiar o texto, o modo de impressão só com a folha, a ligação de partilha, o jogo sem remates), e a página que só mostra a equipa da conta (e um adversário aberto pelo URL), criar um jogo escrevendo o adversário (reaproveita o que já existe), a área de convidado (lista de jogos das últimas 24 horas com resultado e hora do último evento, jogos sem eventos pela hora marcada, abrir o jogo sem ligação nem botão de partilha, o dono esconder e voltar a mostrar o jogo, ainda aberto às 23 horas e só com ligação às 25; colar a ligação, lista de jogos neste dispositivo). Uma segunda conta confirma que não vê nada da primeira. |
| `e2e/servidor.mjs` | Faz o papel do nginx: serve `frontend/` e reencaminha `/api` e `/hub` (incluindo WebSockets) para a API. |
| `correio.mjs` | Lê os emails da caixa de correio de teste (API HTTP do Mailpit) e tira deles o código da ligação de confirmação ou de recuperação da palavra-passe. |
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
