# handball-scouting-app

Plataforma de scouting e play-by-play para andebol, em tempo real.

O adjunto, no banco e com um tablet, toca num mapa do campo para marcar **onde** foi o remate, escolhe **quem** rematou e carrega no resultado (**golo, defesa, fora, poste ou bloqueado**). O treinador e os adeptos veem um dashboard que se atualiza sozinho, sem recarregar a página, para decidir o momento certo de pedir um time-out.

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

## Usar no jogo

**Banco** (`banco.html?jogo=ID`):

1. Escolhe a equipa que ataca (botões no topo do mapa).
2. Toca no mapa onde foi o remate (a baliza está no topo; o lado esquerdo do ecrã é a esquerda de quem ataca).
3. Toca no jogador.
4. Toca no resultado. O remate fica registado e o mapa limpa-se para o seguinte.

Ainda no banco:
- **7 metros** põe logo o ponto na marca dos 7 m. **Contra-ataque** é outra situação de remate.
- O **guarda-redes** adversário vem pré-escolhido (o de menor número); muda-se na lista se houver troca.
- **Outros eventos** (falta ofensiva, perda de bola, 2 minutos, time-out) registam-se com um toque. Se tiveres um jogador escolhido, fica associado a ele.
- **Relógio**: o tempo de jogo é guardado com cada evento (necessário para o parcial dos últimos minutos). Fica guardado no tablet, por isso recarregar a página não o perde. Usa `1.ª parte` para passar à 2.ª parte (aos 30:00) e `✎` para acertar o minuto.
- **Desfazer**: `↶ Desfazer último` ou o `✕` ao lado de cada evento.

**Dashboard** (`dashboard.html?jogo=ID`): placar, eficácia por equipa, parcial dos últimos 5 minutos (com aviso quando há uma diferença de 3 ou mais golos), mapa de remates com filtros, jogadores, zonas, guarda-redes, outros eventos e últimos eventos.

## Mapa e zonas

O mapa é o meio-campo de ataque (20 m × 20 m). Cada clique guarda `x` e `y` em percentagem (0 a 100): `x` vai da esquerda (0) à direita (100) de quem ataca e `y` vai da linha de baliza (0) ao meio-campo (100).

O PostgreSQL calcula sozinho duas colunas de `eventos` a partir de `x` e `y` (colunas geradas, ver `db/init/01_schema.sql`):

| Coluna      | Valores |
|-------------|---------|
| `corredor`  | `PONTA_ESQ`, `LATERAL_ESQ`, `CENTRAL`, `LATERAL_DIR`, `PONTA_DIR` |
| `distancia` | `ATE_6M`, `DE_6_A_9M`, `LINHA_9M` (9 a 11 m), `MAIS_9M` |

A distância é medida à baliza, com a mesma geometria das linhas de 6 m e 9 m desenhadas no mapa. As fronteiras estão nas funções `zona_corredor` e `zona_distancia`; se quiseres outros limites, é lá que se mudam.

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
| GET | `/api/jogos/{id}` | Jogo e jogadores das duas equipas |
| GET | `/api/tipos-evento` | Tipos de evento disponíveis |
| GET | `/api/jogos/{id}/estatisticas` | Estado completo (o mesmo que o dashboard recebe) |
| GET | `/api/jogos/{id}/estatisticas/eficacia` | Eficácia com filtros |
| GET | `/api/jogos/{id}/estatisticas/guarda-redes` | Defesas com filtros |
| POST | `/api/jogos/{id}/eventos` | Regista um evento |
| DELETE | `/api/jogos/{id}/eventos/{eventoId}` | Apaga um evento |
| WS | `/hub/jogo` | Hub SignalR: `EntrarNoJogo(jogoId)` e mensagem `EstatisticasAtualizadas` |

Exemplo de remate:

```bash
curl -X POST http://localhost:8080/api/jogos/1/eventos -H "Content-Type: application/json" -d '{
  "tipoEvento": "REMATE", "equipaId": 1, "jogadorId": 4, "guardaRedesId": 10,
  "resultado": "GOLO", "situacao": "POSICIONAL", "x": 30, "y": 52, "parte": 1, "segundoJogo": 600
}'
```

## Dados reais: equipas, jogadores e jogos

Os dados de `db/init/03_equipas_jogadores.sql` são fictícios. Para os teus, edita esse ficheiro (e apaga `04_demo_eventos.sql`) antes de criar a base de dados, ou insere diretamente:

```sql
INSERT INTO equipas (nome) VALUES ('A minha equipa'), ('Adversário');
INSERT INTO jogadores (equipa_id, numero, nome, posicao_codigo)
VALUES (3, 1, 'Nome do GR', 'GR'), (3, 7, 'Nome do ponta', 'PE');   -- usa os ids das equipas criadas
INSERT INTO jogos (equipa_casa_id, equipa_fora_id, local) VALUES (3, 4, 'Pavilhão X');
```

Ainda não há ecrãs para gerir equipas, jogadores e jogos: por agora fazem-se em SQL.

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
dotnet test api/HandballScouting.sln        # regras de validação dos eventos (xUnit)

# SQL: com o PostgreSQL a correr e PGHOST, PGUSER, PGPASSWORD e PGDATABASE definidos
psql -v ON_ERROR_STOP=1 -f db/tests/zonas.sql          # zonas do campo
python3 db/tests/validar_consultas.py                  # todas as consultas contra o esquema
```

O workflow `.github/workflows/ci.yml` corre em cada push para `main` e em cada pull request:

1. **API**: restaura, compila e corre os testes .NET.
2. **Base de dados**: cria o esquema num PostgreSQL temporário, carrega os dados, corre `db/tests` e valida as consultas.
3. **Docker**: valida o `docker-compose.yml` e compila as imagens da API e do frontend. Em `main`, publica-as no GitHub Container Registry (`ghcr.io/<utilizador>/<repositório>/api` e `/frontend`).

## Limitações atuais

- Se a rede falhar no momento de registar, o evento **não** fica em fila: aparece um aviso e é preciso tocar outra vez.
- Não há autenticação: quem abrir o endereço pode registar eventos. Usa a app numa rede de confiança.
- O estado completo é recalculado e enviado a cada evento. Para um jogo de andebol (algumas centenas de eventos) é muito rápido.

## Estrutura

```
api/                   API ASP.NET Core (Program.cs, SignalR, consultas em Sql/) e testes
db/init/               esquema, dados base, equipas/jogadores e demo (correm por ordem)
db/tests/              testes SQL
frontend/              páginas (index, banco, dashboard), JS e CSS; lib/ tem o cliente SignalR
docker-compose.yml     os 3 contentores
.github/workflows/     CI
```
