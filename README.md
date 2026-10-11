# handball-scouting-app

Plataforma de scouting e play-by-play para andebol, em tempo real.

O adjunto, no banco e com um tablet, toca num mapa do campo para marcar **onde** foi o remate, escolhe **quem** rematou e carrega no resultado (**golo, defesa, fora, poste ou bloqueado**). O treinador e os adeptos veem um dashboard que se atualiza sozinho, sem recarregar a página, para decidir o momento certo de pedir um time-out.

Antes do jogo gerem-se as **equipas e os jogadores**, cria-se o **jogo** e escolhe-se a **convocatória** (até 16 jogadores por equipa). No fim (ou durante o jogo) exportam-se as **estatísticas para Excel**. A interface tem um visual escuro e futurista, pensado para tablet.

## Como funciona

```
 Tablet (banco.html) ──POST /api/jogos/{id}/eventos──▶  API ASP.NET Core ──▶ PostgreSQL
                                                          │
 Dashboard (dashboard.html) ◀──── WebSocket (SignalR) ────┘  estado novo a cada evento
```

Três contentores Docker:

| Contentor  | O que é                                   | Pasta       |
|------------|-------------------------------------------|-------------|
| `frontend` | nginx com as páginas e o proxy para a API | `frontend/` |
| `api`      | ASP.NET Core 8 + SignalR + Dapper         | `api/`      |
| `db`       | PostgreSQL 16 (esquema criado em `db/init`) | `db/`     |

## Arrancar

Precisas do Docker com Docker Compose.

```bash
docker compose up --build
```

Abre **http://localhost:8080**. Há dois jogos de exemplo: o jogo 1 está vazio e o jogo 2 já tem eventos fictícios (e um parcial que dispara o aviso de time-out).

- **No tablet**: liga-o à mesma rede do computador e abre `http://<IP-do-computador>:8080`.
- **Configuração** (porta, palavra-passe): copia `.env.example` para `.env`.
- **Recomeçar do zero**: `docker compose down -v` apaga a base de dados; ao arrancar de novo os scripts de `db/init` voltam a correr.
- **Já tinhas a app a correr de uma versão anterior?** As versões novas acrescentam à base de dados a convocatória (`05_convocados.sql`) e o local da defesa na baliza (`06_baliza.sql`). Sem apagar nada, atualiza o código (`git pull`) e corre os dois ficheiros, que podem repetir-se sem problema:
  ```powershell
  # PowerShell (Windows)
  Get-Content db/init/05_convocados.sql -Raw | docker compose exec -T db psql -U scouting -d scouting
  Get-Content db/init/06_baliza.sql -Raw | docker compose exec -T db psql -U scouting -d scouting
  docker compose up -d --build
  ```
  ```bash
  # Linux, macOS
  docker compose exec -T db psql -U scouting -d scouting < db/init/05_convocados.sql
  docker compose exec -T db psql -U scouting -d scouting < db/init/06_baliza.sql
  docker compose up -d --build
  ```
  (ou então `docker compose down -v` e arrancar de novo, o que apaga os dados.) O `06_baliza.sql` também marca o local das defesas do jogo de exemplo 2, se ainda não houver nenhum local guardado.

## Preparar o jogo

1. **Equipas e jogadores** (`equipas.html`, botão *Equipas* no topo da lista de jogos): cria equipas, e para cada uma adiciona, edita ou apaga jogadores (número 1–99, nome e posição). O número livre mais baixo é sugerido. Um jogador que já tem eventos registados não pode ser apagado (os dados do jogo ficariam incoerentes).
2. **Novo jogo** (lista de jogos, *Novo jogo*): escolhe a equipa da casa, a de fora e, se quiseres, o local e a data e hora. Depois de criar, abre-se a convocatória.
3. **Convocatória** (`convocatoria.html?jogo=ID`): toca nos jogadores que vão ao jogo, até **16 por equipa**. *Todos* e *Nenhum* aceleram a escolha e há um aviso se não houver guarda-redes convocado. Fica guardada no servidor; podes voltar a alterá-la a qualquer momento.

Enquanto um jogo não tiver convocatória guardada numa equipa, o banco mostra todos os jogadores dessa equipa (e sugere fazer a convocatória). Com convocatória, o banco só mostra os convocados.

## Usar no jogo

**Banco** (`banco.html?jogo=ID`):

1. Escolhe a equipa que ataca (botões no topo do mapa).
2. Toca no mapa onde foi o remate (a baliza está no topo; o lado esquerdo do ecrã é a esquerda de quem ataca).
3. Toca no jogador.
4. Toca no resultado. O remate fica registado e o mapa limpa-se para o seguinte.

**Defesa**: ao tocar em *Defesa* aparece a **baliza** (vista de frente, do lado de quem remata) com o nome do guarda-redes adversário. Toca no sítio onde ele defendeu a bola e a defesa fica registada com esse local. *Registar sem local* grava a defesa sem o ponto (útil quando não deu para ver) e *Cancelar* (ou `Esc`) não regista nada e mantém o mapa e o jogador escolhidos.

Ainda no banco:
- **7 metros** põe logo o ponto na marca dos 7 m. **Contra-ataque** é outra situação de remate.
- O **guarda-redes** adversário vem pré-escolhido (o de menor número); muda-se na lista se houver troca.
- **Outros eventos** (falta ofensiva, perda de bola, 2 minutos, time-out) registam-se com um toque. Se tiveres um jogador escolhido, fica associado a ele.
- **Relógio**: o tempo de jogo é guardado com cada evento (necessário para o parcial dos últimos minutos). Fica guardado no tablet, por isso recarregar a página não o perde. Usa `1.ª parte` para passar à 2.ª parte (aos 30:00) e `✎` para acertar o minuto.
- **Desfazer**: `↶ Desfazer último` ou o `✕` ao lado de cada evento.

**Dashboard** (`dashboard.html?jogo=ID`): placar, eficácia por equipa, parcial dos últimos 5 minutos (com aviso quando há uma diferença de 3 ou mais golos), mapa de remates com filtros, **defesas na baliza** (onde o guarda-redes adversário defendeu os remates da equipa escolhida, com a contagem por zona e a zona mais atacada), jogadores, zonas, guarda-redes, outros eventos e últimos eventos.

## Exportar para Excel

No dashboard, na lista de jogos e na convocatória há botões **⬇ Excel**:

- **Jogo completo**: as duas equipas.
- **Só uma equipa**: no dashboard, escolhe a aba da equipa (*Ver: ...*) e usa o botão Excel dessa aba.

Também se pode pedir diretamente: `GET /api/jogos/2/exportar.xlsx` (jogo completo) ou `GET /api/jogos/2/exportar.xlsx?equipaId=2` (uma equipa).

O ficheiro `.xlsx` tem uma folha por assunto: **Resumo** (resultado, remates, golos e eficácia por equipa, parcial dos últimos 5 minutos), **Jogadores** (remates, golos e eficácia, com a indicação de quem foi convocado), **Por posição**, **Por corredor**, **Por distância**, **Por parte**, **Guarda-redes** (defesas, golos sofridos e % de defesa), **Defesas na baliza** (por guarda-redes, quantas defesas em cada uma das 9 zonas da baliza e quantas sem local), **Outros eventos** e **Eventos** (todos os eventos com tempo, jogador, resultado, coordenadas no mapa e, nas defesas, o guarda-redes e o local na baliza). Os cabeçalhos ficam fixos e as tabelas têm filtros, por isso dá para ordenar e filtrar logo no Excel. Os valores são números (não texto), por isso servem para fórmulas e gráficos.

A data e hora que aparecem no ficheiro usam o fuso horário `Europe/Lisbon`. Para mudar, define `FUSO_HORARIO` no `.env` (por exemplo `Atlantic/Azores`).

## Mapa e zonas

O mapa é o meio-campo de ataque (20 m × 20 m). Cada clique guarda `x` e `y` em percentagem (0 a 100): `x` vai da esquerda (0) à direita (100) de quem ataca e `y` vai da linha de baliza (0) ao meio-campo (100).

O PostgreSQL calcula sozinho duas colunas de `eventos` a partir de `x` e `y` (colunas geradas, ver `db/init/01_schema.sql`):

| Coluna      | Valores |
|-------------|---------|
| `corredor`  | `PONTA_ESQ`, `LATERAL_ESQ`, `CENTRAL`, `LATERAL_DIR`, `PONTA_DIR` |
| `distancia` | `ATE_6M`, `DE_6_A_9M`, `LINHA_9M` (9 a 11 m), `MAIS_9M` |

A distância é medida à baliza, com a mesma geometria das linhas de 6 m e 9 m desenhadas no mapa. As fronteiras estão nas funções `zona_corredor` e `zona_distancia`; se quiseres outros limites, é lá que se mudam.

### Baliza

A baliza (3 m × 2 m) vista de frente, do lado de quem remata, guarda `baliza_x` e `baliza_y` em percentagem: `baliza_x` vai do poste esquerdo (0) ao direito (100) e `baliza_y` vai da trave (0) ao chão (100). Só existem em remates com resultado `DEFESA`, são opcionais, e vêm sempre os dois ou nenhum (a base de dados recusa o resto). O PostgreSQL calcula a coluna `baliza_zona` (3 × 3):

| Linha | Colunas |
|-------|---------|
| `ALTO`, `MEIO`, `BAIXO` | `ESQ`, `CENTRO`, `DIR` (por exemplo `ALTO_ESQ`, `BAIXO_DIR`) |

Os limites estão na função `zona_baliza` (`db/init/06_baliza.sql`) e a vista `v_remates` expõe as três colunas.

## Consultas SQL

As consultas estão em `api/HandballScouting.Api/Sql/*.sql` e usam `COUNT(...) FILTER (WHERE ...)` e `GROUP BY` sobre a vista `v_remates`. Duas delas aceitam filtros opcionais (um filtro por indicar é ignorado) e respondem às perguntas do enunciado:

```bash
# Eficácia de remate do lateral esquerdo, na linha de 9 m, na 2.ª parte
curl "http://localhost:8080/api/jogos/2/estatisticas/eficacia?posicao=LE&distancia=LINHA_9M&parte=2"

# Defesas dos guarda-redes nos remates das pontas ("PONTA" apanha PONTA_ESQ e PONTA_DIR)
curl "http://localhost:8080/api/jogos/2/estatisticas/guarda-redes?corredor=PONTA"
```

Filtros de `eficacia`: `equipaId`, `jogadorId`, `posicao` (`GR`, `PE`, `LE`, `CE`, `LD`, `PD`, `PV`), `corredor`, `distancia`, `parte`, `situacao` (`POSICIONAL`, `CONTRA_ATAQUE`, `SETE_METROS`).
Filtros de `guarda-redes`: `jogadorId`, `corredor`, `distancia`, `parte`, `situacao`.

Também podes correr SQL diretamente na base de dados (a porta 5432 está aberta só neste computador):

```bash
docker compose exec db psql -U scouting -d scouting
```

## API

| Método | Rota | Para quê |
|--------|------|----------|
| GET | `/api/jogos` | Lista de jogos com resultado |
| POST | `/api/jogos` | Cria um jogo: `{ "casaId", "foraId", "local", "dataHora" }` (local e data opcionais) |
| GET | `/api/jogos/{id}` | Jogo e jogadores das duas equipas (com `convocado`) |
| GET | `/api/jogos/{id}/convocados` | Ids dos jogadores convocados e máximo por equipa |
| PUT | `/api/jogos/{id}/convocados` | Substitui a convocatória: `{ "jogadorIds": [1, 2, ...] }` (máx. 16 por equipa) |
| GET | `/api/jogos/{id}/exportar.xlsx` | Estatísticas em Excel (`?equipaId=` para uma só equipa) |
| GET | `/api/equipas` | Equipas com o número de jogadores |
| POST | `/api/equipas` | Cria uma equipa: `{ "nome" }` |
| GET | `/api/equipas/{id}/jogadores` | Plantel (com o número de eventos de cada jogador) |
| POST | `/api/equipas/{id}/jogadores` | Adiciona um jogador: `{ "numero", "nome", "posicao" }` |
| PUT | `/api/jogadores/{id}` | Edita um jogador |
| DELETE | `/api/jogadores/{id}` | Apaga um jogador (409 se tiver eventos) |
| GET | `/api/tipos-evento` | Tipos de evento disponíveis |
| GET | `/api/jogos/{id}/estatisticas` | Estado completo (o mesmo que o dashboard recebe) |
| GET | `/api/jogos/{id}/estatisticas/eficacia` | Eficácia com filtros |
| GET | `/api/jogos/{id}/estatisticas/guarda-redes` | Defesas com filtros |
| POST | `/api/jogos/{id}/eventos` | Regista um evento |
| DELETE | `/api/jogos/{id}/eventos/{eventoId}` | Apaga um evento |
| WS | `/hub/jogo` | Hub SignalR: `EntrarNoJogo(jogoId)` e mensagem `EstatisticasAtualizadas` |

Numa defesa podes juntar `"balizaX"` e `"balizaY"` (0 a 100, os dois juntos) com o sítio onde o guarda-redes defendeu; em qualquer outro resultado a API responde 400. O estado das estatísticas devolve `balizaX`, `balizaY` e `balizaZona` em cada remate do mapa e `balizaZona` nos últimos eventos.

Exemplo de remate:

```bash
curl -X POST http://localhost:8080/api/jogos/1/eventos -H "Content-Type: application/json" -d '{
  "tipoEvento": "REMATE", "equipaId": 1, "jogadorId": 4, "guardaRedesId": 10,
  "resultado": "GOLO", "situacao": "POSICIONAL", "x": 30, "y": 52, "parte": 1, "segundoJogo": 600
}'
```

## Dados reais

As equipas, jogadores e jogos de `db/init/03_equipas_jogadores.sql` e `04_demo_eventos.sql` são fictícios, só para experimentares. Cria os teus pelos ecrãs da app (**Equipas** e **Novo jogo**). Se quiseres começar sem os exemplos, apaga esses dois ficheiros antes de criar a base de dados.

## Adicionar um novo tipo de evento

Por exemplo, contabilizar "passes errados". Os tipos vivem na tabela `tipos_evento`, por isso não é preciso mexer no código: o botão aparece sozinho no banco e a contagem aparece em "Outros eventos" no dashboard.

1. Cria `db/init/05_passe_errado.sql`:
   ```sql
   INSERT INTO tipos_evento (codigo, nome, e_remate, ordem) VALUES ('PASSE_ERRADO', 'Passe errado', FALSE, 6);
   ```
2. Numa base de dados que já existe, corre a mesma instrução:
   `docker compose exec db psql -U scouting -d scouting -c "INSERT INTO tipos_evento ..."`.
   (Os ficheiros de `db/init` só correm quando a base de dados é criada de raiz.)
3. Faz commit e push: o GitHub Actions volta a validar tudo.

Um tipo com `e_remate = TRUE` seria um evento com posição no mapa, jogador e resultado, e exigiria mudanças nas consultas.

## Testes e CI

```bash
dotnet test api/HandballScouting.sln        # validação, exportação para Excel e cadastro (xUnit)

# SQL: com o PostgreSQL a correr e PGHOST, PGUSER, PGPASSWORD e PGDATABASE definidos
psql -v ON_ERROR_STOP=1 -f db/tests/zonas.sql          # zonas do campo
psql -v ON_ERROR_STOP=1 -f db/tests/convocados.sql     # convocatória
psql -v ON_ERROR_STOP=1 -f db/tests/baliza.sql         # zonas e regras da baliza
python3 db/tests/validar_consultas.py                  # todas as consultas contra o esquema
```

Há ainda testes que usam a **API verdadeira** e um browser (pasta `tests/`, ver `tests/README.md`):

- `tests/integracao/integracao.mjs`: percorre a API por HTTP e SignalR (estatísticas, equipas, jogadores, jogos, convocatória, eventos, local das defesas na baliza, atualizações em tempo real e descarga do Excel);
- `tests/integracao/verificar_excel.py`: abre os `.xlsx` descarregados e confere os números com os dados de exemplo;
- `tests/e2e/fluxos.mjs`: abre as páginas num Chromium e usa-as como um utilizador (criar equipas e jogadores, convocatória, registar remates no banco, marcar na baliza onde o guarda-redes defendeu e vê-los chegar ao dashboard por WebSocket, descarregar o Excel).

O workflow `.github/workflows/ci.yml` corre em cada push para `main` e em cada pull request:

1. **API**: restaura, compila e corre os testes .NET.
2. **Base de dados**: cria o esquema num PostgreSQL temporário, carrega os dados, corre `db/tests` e valida as consultas.
3. **Integração**: publica e arranca a API contra um PostgreSQL temporário e corre os testes de `tests/` (API, Excel e browser). As capturas de ecrã e os `.xlsx` gerados ficam disponíveis como artefacto da execução (`resultados-integracao`).
4. **Docker**: valida o `docker-compose.yml` e compila as imagens da API e do frontend. Em `main`, publica-as no GitHub Container Registry (`ghcr.io/<utilizador>/<repositório>/api` e `/frontend`).

## Limitações atuais

- Se a rede falhar no momento de registar, o evento **não** fica em fila: aparece um aviso e é preciso tocar outra vez.
- Não há autenticação: quem abrir o endereço pode registar eventos. Usa a app numa rede de confiança.
- O estado completo é recalculado e enviado a cada evento. Para um jogo de andebol (algumas centenas de eventos) é muito rápido.

## Estrutura

```
api/                   API ASP.NET Core (Program.cs, SignalR, consultas em Sql/, Excel/) e testes xUnit
db/init/               esquema, dados base, equipas/jogadores, demo e convocatória (correm por ordem)
db/tests/              testes SQL
frontend/              páginas (jogos, equipas, convocatória, banco, dashboard), JS, CSS e fontes; lib/ tem o cliente SignalR
tests/                 testes de integração da API, do Excel e de browser (Node + Playwright)
docker-compose.yml     os 3 contentores
.github/workflows/     CI
```
