# handball-scouting-app

Plataforma de scouting e play-by-play para andebol, em tempo real.

O adjunto, no banco e com um tablet, toca num mapa do campo para marcar **onde** foi o remate, escolhe **quem** rematou e carrega no resultado (**golo, defesa, fora, poste ou bloqueado**). O treinador e os adeptos veem um dashboard que se atualiza sozinho, sem recarregar a página, para decidir o momento certo de pedir um time-out. Ao treinador, o dashboard junta um **treinador-assistente** que sugere, com os números que o justificam, quando pedir time-out, quem marcar de perto, quem rever ou por onde estão a marcar.

Antes do jogo gere-se o **plantel da tua equipa**, cria-se o **jogo** (com o nome do adversário) e escolhe-se a **convocatória** (até 16 jogadores por equipa). No fim (ou durante o jogo) exportam-se as **estatísticas para Excel**. A interface é clara e limpa, pensada para tablet e telemóvel.

Cada pessoa cria a **sua conta**, com a **sua equipa**, e só vê e edita a sua equipa, os jogadores e os jogos. A conta só fica ativa depois de **confirmares o email** (recebes um link). Quem quiser só ver um jogo em direto não precisa de conta: entra na **área de convidado**, onde vê logo os **jogos das últimas 24 horas**, ou cola o **link de partilha** do dashboard.

## Como funciona

```
 Tablet (banco.html) ──POST /api/jogos/{id}/eventos──▶  API ASP.NET Core ──▶ PostgreSQL
                                                          │
 Dashboard (dashboard.html) ◀──── WebSocket (SignalR) ────┘  estado novo a cada evento
```

Três contentores Docker (mais o `migrar`, de curta duração, que atualiza a base de dados antes de a API arrancar):

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

Abre **http://localhost:8080** e cria a tua conta (separador *Criar conta*). O email de confirmação chega à **caixa de correio de teste** em **http://localhost:8025** (nada sai para a internet; ver *Email* mais abaixo para usar emails a sério). A **primeira conta confirmada** fica com os dados de exemplo: dois jogos, o jogo 1 vazio e o jogo 2 com eventos fictícios (com uma série de golos do adversário que dispara a sugestão de time-out). As contas seguintes começam vazias.

- **No tablet**: liga-o à mesma rede do computador e abre `http://<IP-do-computador>:8080`.
- **Configuração** (porta, palavra-passe, email): copia `.env.example` para `.env`.
- **Recomeçar do zero**: `docker compose down -v` apaga a base de dados; ao arrancar de novo os scripts de `db/init` voltam a correr.
- **Já tinhas a app a correr de uma versão anterior?** Basta `git pull` e `docker compose up -d --build`. O serviço `migrar` atualiza sozinho a base de dados em cada arranque (convocatória, local da defesa na baliza, contas, confirmação do email, recuperação da palavra-passe, jogos abertos a convidados, uma equipa por conta, expulsões, escudos e superioridade numérica; são scripts que se podem repetir sem problema) e **não apaga nada**. As contas que já existiam ficam logo confirmadas. Se ainda não havia nenhuma conta, a primeira que criares e confirmares fica com as equipas e os jogos que já existiam.

## Contas e partilha

- **Criar conta**: nome, **nome da tua equipa**, email e palavra-passe (8 a 128 caracteres). A equipa fica atribuída à conta (ver *Uma equipa por conta*). A seguir a app envia um **email com um link de confirmação** (vale 24 horas) e só se entra depois de o abrir. A página explica o que fazer e tem **Reenviar email** (com uma pausa de 30 segundos). **Entrar** e **Sair** estão na página de entrada e no menu do topo. A sessão dura 30 dias.
- **Esqueci-me da palavra-passe**: na página de entrada, *Esqueci-me da palavra-passe* pede o email da conta e envia um **link para escolher outra** (vale 1 hora e só serve uma vez). A resposta é sempre a mesma exista a conta ou não, e pedir muitas vezes é travado como na confirmação (3 em 15 minutos por endereço). Ao escolher a palavra-passe nova **terminam todas as sessões** da conta (em todos os dispositivos), o bloqueio por tentativas falhadas desaparece e o email fica confirmado (o link chegou à caixa de correio da pessoa). A seguir entra-se com a palavra-passe nova.
- **Área de convidado** (`convidado.html`, botão *Entrar como convidado* na página de entrada): para quem só quer ver o dashboard. Em cima aparece a lista **Jogos das últimas 24 horas** (equipas, resultado e há quanto tempo houve o último evento; atualiza sozinha a cada 15 segundos; um ponto verde marca os que tiveram um evento nos últimos 30 minutos): um toque abre o dashboard do jogo, **sem link nem conta**. Também se pode colar um link de partilha, e os jogos abertos desse modo ficam numa lista **neste dispositivo** (guardada no browser, com *Tirar* e *Limpar a lista*). Um convidado não consegue registar nem alterar nada, não vê equipas nem jogadores e nunca recebe o código de partilha.
- **Jogos abertos a convidados (24 horas)**: um jogo aparece na área de convidado, e abre-se sem link, durante **24 horas**, contadas a partir do **último evento** registado ou, se ainda não há eventos, da **data e hora do jogo** (aparece nas 24 horas antes de começar e fica 24 horas depois). Passado esse tempo só se abre com o link de partilha ou com a conta do dono. Os jogos de **todas as contas** aparecem na lista, a não ser que o dono desligue **Mostrar na área de convidado** na lista de jogos (vem ligado por omissão). Um jogo escondido continua a abrir-se com o link de partilha.
- **Uma equipa por conta**: cada conta tem a **sua equipa**, escolhida ao criar a conta. A página *Equipas* mostra só essa equipa e o plantel dela. Ao criar um jogo escreves o **nome do adversário** e dizes se a tua equipa joga em casa ou fora; o adversário é criado nessa altura (ou reaproveitado, se já jogaste contra ele) e **não aparece na lista de equipas**: os jogadores dele juntam-se na convocatória do jogo (*Gerir jogadores* ou *Ler de uma foto*). Nas bases de dados que já existiam, cada conta fica com a primeira equipa que já tinha como equipa da conta; as outras passam a ser adversárias e continuam nos jogos que já tinham.
- **Cada conta só vê o que é seu**: equipas, jogadores, jogos, convocatórias e eventos. O que é de outra conta aparece como "não encontrado". O nome de uma equipa só tem de ser único dentro da própria conta.
- **Link de partilha**: na lista de jogos, *Copiar link* copia um endereço do tipo `.../dashboard.html?jogo=2&c=CÓDIGO`. Quem o abrir vê o dashboard **em direto** e pode exportar o Excel, **sem conta**. Não consegue registar nem alterar nada. Cada jogo tem o seu código secreto: trata o link como uma palavra-passe do jogo e só o envias a quem deve ver.
- **Segurança**: a palavra-passe fica guardada só como hash (PBKDF2-SHA256, 600 000 iterações). Os links dos emails (confirmar e redefinir) levam um código aleatório de 256 bits de que só se guarda o SHA-256. Quem pede o email de confirmação várias vezes (3 em 15 minutos por endereço) é travado, e a resposta a esse pedido nunca revela se o email tem conta. O cookie da sessão é `HttpOnly` e `SameSite=Lax` (e `Secure` quando a app está atrás de HTTPS) e a base de dados só guarda o SHA-256 do seu código. Depois de 5 tentativas falhadas para o mesmo email há um bloqueio de 10 minutos.

O registo é aberto a quem conseguir chegar à app (mas só entra quem confirmar o email).

### Email

Por omissão o `docker compose` junta uma caixa de correio de teste (**Mailpit**, http://localhost:8025): todos os emails ficam lá e nenhum sai da tua máquina. Para enviar emails a sério, preenche no `.env` as linhas `EMAIL_*` (servidor, porta, utilizador, palavra-passe, remetente) e `URL_PUBLICO` (o endereço da app tal como as pessoas o veem, que vai dentro do link). Exemplo com o Gmail (precisa de uma *palavra-passe de app*): `EMAIL_HOST=smtp.gmail.com`, `EMAIL_PORTA=587`, `EMAIL_SSL=true`, `EMAIL_UTILIZADOR` e `EMAIL_DE` com o teu endereço e `EMAIL_SENHA` com a palavra-passe de app. O envio usa SMTP com STARTTLS (porta 587); a porta 465 (TLS direto) não é suportada. Se o email não conseguir seguir, a conta fica criada e a página oferece **Reenviar email**. O email de recuperação da palavra-passe sai pelo mesmo caminho.

## Preparar o jogo

1. **A tua equipa e os jogadores** (`equipas.html`, botão *Equipas* no topo da lista de jogos): adiciona, edita ou apaga os jogadores da tua equipa (número 1–99, nome e posição). O número livre mais baixo é sugerido. Um jogador que já tem eventos registados não pode ser apagado (os dados do jogo ficariam incoerentes). **Escudo**: no topo do plantel há *Escolher imagem* para pôr o símbolo do clube (PNG, JPEG, WebP ou SVG; o browser reduz-o a 256 px antes de o enviar, por isso nunca falha por ser grande) e *Tirar escudo*. Também se põe o escudo de um adversário: abre-o a partir da convocatória. Aparece no placar do banco e do dashboard, na lista de jogos, na área de convidado, na convocatória e na lista de equipas; quem não tem escudo fica só com o nome.
2. **Novo jogo** (lista de jogos, *Novo jogo*): escreve o nome do adversário (os que já usaste aparecem como sugestão), diz se a tua equipa joga em casa ou fora e, se quiseres, o local e a data e hora. Depois de criar, abre-se a convocatória.
3. **Convocatória** (`convocatoria.html?jogo=ID`): toca nos jogadores que vão ao jogo, até **16 por equipa**. *Todos* e *Nenhum* aceleram a escolha e há um aviso se não houver guarda-redes convocado. Fica guardada no servidor; podes voltar a alterá-la a qualquer momento. Em vez de tocar um a um, *Ler de uma foto* (por baixo do nome de cada equipa) deixa-te escolher uma foto ou um print da convocatória, ver mais abaixo.

### Ler a convocatória de uma foto

Na convocatória, cada equipa tem o botão **Ler de uma foto**. Escolhe uma foto (da câmara, no telemóvel ou tablet) ou um print, **ou arrasta a imagem / cola um print com Ctrl+V**. A app lê o texto e mostra uma lista para **rever**: cada linha tem o número, o nome e a posição, e podes corrigir, tirar a marca a quem não joga ou *Adicionar jogador*. Quem já existe na equipa (mesmo número) fica ligado a esse jogador; os outros são **adicionados à equipa** ao confirmar. Depois é só *Guardar convocatória*. Cancelar não muda nada.

- **A imagem não sai do dispositivo**: a leitura (OCR, Tesseract) corre no próprio browser, sem chave, sem custos e sem enviar nada para a internet. O leitor (cerca de 5 MB, em `frontend/lib/tesseract/`) só se descarrega quando alguém lê a primeira foto e o browser guarda-o.
- **Formatos que entende**, uma linha por jogador: `7 João Silva`, `7 - João Silva (GR)`, `#7 JOÃO SILVA GR`, `Nº 7 | JOÃO SILVA | 123456`, `João Silva 7`. Ignora cabeçalhos, horas e datas, e os números das licenças. A posição só é lida se vier escrita (`GR`, `PE`, `LD`, «guarda-redes»...); senão fica *Central* para ajustares aqui ou em Equipas.
- **Funciona bem** com texto impresso ou digital: fichas de jogo, listas de Excel ou Word, prints de mensagens (também em modo escuro). Tira a foto de frente, com boa luz, sem sombras e com a lista a ocupar a imagem.
- **Letra manuscrita quase nunca se lê bem**: nesse caso a lista de revisão serve para escrever o que faltar. Por isso confere sempre os números e os nomes antes de confirmar: acentos e letras parecidas (o OCR confunde-as de vez em quando) corrigem-se na própria linha.
- Precisa de um browser recente (os de hoje têm tudo; sem suporte, a janela avisa).

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
- **Outros eventos** (falta ofensiva, perda de bola, 2 minutos, vermelho direto, time-out) registam-se com um toque. Se tiveres um jogador escolhido, fica associado a ele.
- **Expulsões**: ao **3.º «2 minutos»** do mesmo jogador, ou com um **vermelho direto** (que exige um jogador escolhido), o jogador está desqualificado: no banco o botão dele fica a cinzento com «Expulso» e já não se pode escolher (o motivo aparece ao passar o rato). Com 1 ou 2 «2 minutos» continua disponível e mostra um contador (`2′×1`, `2′×2`). Continua na grelha, e os remates e eventos que já tem ficam nas estatísticas. Se o registo foi engano, apaga o evento (`↶ Desfazer último` ou `✕`) e o jogador volta a poder jogar. Um «2 minutos» sem jogador escolhido não conta para ninguém (serve para um treinador ou oficial). Os guarda-redes não aparecem na grelha do banco, por isso as sanções são só para jogadores de campo.
- **Relógio**: o tempo de jogo é guardado com cada evento (necessário para o parcial dos últimos minutos). Fica guardado no tablet, por isso recarregar a página não o perde. Usa `1.ª parte` para passar à 2.ª parte (aos 30:00) e `✎` para acertar o minuto.
- **Superioridade numérica**: cada «2 minutos» e cada vermelho direto deixa a equipa com **menos um jogador de campo durante 2 minutos** (o 3.º «2 minutos» do mesmo jogador também). Por baixo do marcador aparece uma faixa com a situação (`6×5` e quem está em superioridade) e **a contagem decrescente de cada sanção** (`#7 1:12`); desaparece sozinha quando os 2 minutos acabam. Conta-se com o **relógio do banco**, por isso arranca-o (▶) ao início do jogo: com o relógio sempre a 00:00 o banco avisa e não inventa nada. Os 2 minutos não acabam com um golo e em campo ficam sempre pelo menos 4 jogadores (no máximo 2 a menos por equipa).
- **Ataque 7×6**: o botão **Ataque 7×6** (junto aos outros eventos) liga e desliga o ataque sem guarda-redes da equipa que está a atacar (a escolhida em «Ataca: …»). Fica a faixa `7×6 · Equipa` enquanto estiver ligado. Os remates feitos nesse período contam à parte, e os do adversário contra a baliza vazia também.
- **Desfazer**: `↶ Desfazer último` ou o `✕` ao lado de cada evento.

**Dashboard** (`dashboard.html?jogo=ID`, com `&c=CÓDIGO` para quem só tem o link): o **treinador-assistente** (só para o dono do jogo, ver abaixo), placar, eficácia por equipa, parcial dos últimos 5 minutos, mapa de remates com filtros, **defesas na baliza** (onde o guarda-redes adversário defendeu os remates da equipa escolhida, com a contagem por zona e a zona mais atacada), jogadores, zonas, guarda-redes, outros eventos, **sanções** (quem viu 2 minutos ou vermelho e quem está expulso), **superioridade numérica** e últimos eventos. No topo do cabeçalho está o **relógio do jogo** (o do banco, em leitura) e, quando há alguém a menos ou um ataque 7×6, a faixa com a contagem decrescente dos 2 minutos. O quadro «Superioridade numérica» mostra, para a equipa escolhida, os remates, golos e eficácia em **superioridade, igualdade, inferioridade, ataque 7×6 e contra baliza vazia**, os golos sofridos na situação contrária («Sofr.») e o tempo passado em cada uma. Os 7 metros ficam de fora: é um castigo, não depende de quantos estão em campo.

### Treinador-assistente

No topo do dashboard do **dono do jogo** há um painel com os time-outs de cada equipa (`0/3 usados · pode pedir 2`) e até 6 sugestões, as mais importantes primeiro. Cada uma diz **porquê**, com os números (por exemplo «4 golos em 5 remates (80%)»), para o treinador confiar ou discordar: a decisão é sempre dele. Vêm de regras simples sobre os dados que já existem, sem adivinhar nada, e só disparam a partir de um número mínimo de remates, golos ou eventos (poucos remates enganam em qualquer percentagem):

| Sugestão | Quando aparece | Para quem |
|---|---|---|
| **Time-out** (urgente) | o adversário marcou **4 golos seguidos** ou ganha por **3 ou mais golos nos últimos 5 minutos** (só com o relógio do banco em uso); só conta o que veio depois do último time-out dessa equipa. Se já não tem time-outs, passa a um aviso | a equipa que sofre |
| **Sanções** | um jogador com **dois «2 minutos»** que ainda não foi expulso (o terceiro desqualifica) | a equipa do jogador |
| **Aproveitar mal a superioridade** | **35% ou menos** de golos com mais um jogador, em 4 remates ou mais | a equipa |
| **Defender melhor em inferioridade** | o adversário marcou **65% ou mais** quando esta equipa jogava com menos um, em 4 remates ou mais | a equipa |
| **Guarda-redes** | **20% ou menos** de defesas em 8 remates à baliza ou mais (considerar trocar); **45% ou mais** (variar as finalizações) | a equipa do guarda-redes / o adversário |
| **Marcar de perto** | um jogador do adversário com **3 golos ou mais, 70% ou mais**, em 4 remates ou mais | a equipa que defende |
| **Rever jogador** | um jogador com **25% ou menos** de golos em 5 remates ou mais | a própria equipa |
| **Fechar o corredor** | o adversário marca **70% ou mais** por um corredor (ponta, lateral ou central), com 5 remates e 4 golos ou mais | a equipa que defende |
| **7×6 a sair caro** | mais golos sofridos na baliza vazia do que marcados (3 ou mais lances) | a equipa |
| **Perdas de bola** | 6 perdas ou mais e 4 a mais do que o adversário | a equipa |

Os **time-outs** seguem as regras da IHF: 3 por jogo e no máximo 2 por parte (a 2.ª parte começa aos 30:00 do relógio; sem relógio, vale a parte do último evento). Outras competições têm outros números: estão no topo de `api/HandballScouting.Api/Assistente.cs`, junto com todos os limiares, para se acertarem num sítio só. As sugestões do relógio (parcial, superioridade, 7×6) só aparecem se o relógio do banco foi usado; sem ele, os eventos ficam todos a 00:00 e não se inventa nada. Quem vê o jogo só pelo link (ou numa conta que não é a do dono) vê o dashboard sem este painel: é uma escolha do ecrã (o servidor envia as sugestões a todos os dashboards, tal como já envia as estatísticas de que elas saem).

## Exportar para Excel

No dashboard, na lista de jogos e na convocatória há botões **⬇ Excel** (quem abriu o link de partilha também os tem no dashboard):

- **Jogo completo**: as duas equipas.
- **Só uma equipa**: no dashboard, escolhe a aba da equipa (*Ver: ...*) e usa o botão Excel dessa aba.

Também se pode pedir diretamente (com a sessão da conta dona ou com `?c=CÓDIGO`): `GET /api/jogos/2/exportar.xlsx` (jogo completo) ou `GET /api/jogos/2/exportar.xlsx?equipaId=2` (uma equipa).

O ficheiro `.xlsx` tem uma folha por assunto: **Resumo** (resultado, remates, golos e eficácia por equipa, parcial dos últimos 5 minutos), **Jogadores** (remates, golos e eficácia, com a indicação de quem foi convocado), **Por posição**, **Por corredor**, **Por distância**, **Por parte**, **Guarda-redes** (defesas, golos sofridos e % de defesa), **Defesas na baliza** (por guarda-redes, quantas defesas em cada uma das 9 zonas da baliza e quantas sem local), **Outros eventos** (inclui os 2 minutos e os vermelhos por equipa) e **Eventos** (todos os eventos com tempo, jogador, resultado, coordenadas no mapa e, nas defesas, o guarda-redes e o local na baliza). Os cabeçalhos ficam fixos e as tabelas têm filtros, por isso dá para ordenar e filtrar logo no Excel. Os valores são números (não texto), por isso servem para fórmulas e gráficos.

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
# (o código do jogo está no link de partilha, ?c=...; a conta dona pode usar a sessão em vez dele)
curl "http://localhost:8080/api/jogos/2/estatisticas/eficacia?posicao=LE&distancia=LINHA_9M&parte=2&c=CÓDIGO"

# Defesas dos guarda-redes nos remates das pontas ("PONTA" apanha PONTA_ESQ e PONTA_DIR)
curl "http://localhost:8080/api/jogos/2/estatisticas/guarda-redes?corredor=PONTA&c=CÓDIGO"
```

Filtros de `eficacia`: `equipaId`, `jogadorId`, `posicao` (`GR`, `PE`, `LE`, `CE`, `LD`, `PD`, `PV`), `corredor`, `distancia`, `parte`, `situacao` (`POSICIONAL`, `CONTRA_ATAQUE`, `SETE_METROS`).
Filtros de `guarda-redes`: `jogadorId`, `corredor`, `distancia`, `parte`, `situacao`.

Também podes correr SQL diretamente na base de dados (a porta 5432 está aberta só neste computador):

```bash
docker compose exec db psql -U scouting -d scouting
```

## API

As rotas de **conta** e as rotas de **leitura de um jogo** estão abertas; todas as outras precisam de sessão (sem ela, 401). As de leitura aceitam a sessão da conta dona **ou** o código do link de partilha (`?c=CÓDIGO`); para qualquer outra pessoa o jogo "não existe" (404).

| Método | Rota | Para quê |
|--------|------|----------|
| POST | `/api/conta/registar` | Cria a conta e a sua equipa (sem sessão) e envia o email de confirmação: `{ "nome", "equipa", "email", "palavraPasse" }` (o nome da equipa é obrigatório, até 80 caracteres) → 201 `{ "email", "emailEnviado" }` (400 inválido; 409 email repetido, com `"codigo": "email_por_confirmar"` se a conta ainda não foi confirmada; 429 se já pediu muitos emails) |
| POST | `/api/conta/confirmar-email` | Confirma o email com o código do link: `{ "token" }` (204; 400 se o link é inválido ou expirou) |
| POST | `/api/conta/reenviar-confirmacao` | Envia outro email de confirmação: `{ "email" }` (204 sempre que o pedido é válido, exista a conta ou não; 429 se pediu muitos; 503 se o email não seguiu) |
| POST | `/api/conta/esqueci-palavra-passe` | Envia o link para escolher outra palavra-passe: `{ "email" }` (204 sempre que o pedido é válido, exista a conta ou não; 429 se pediu muitos; 503 se o email não seguiu) |
| POST | `/api/conta/redefinir-palavra-passe` | Escolhe a palavra-passe nova com o código do link: `{ "token", "palavraPasse" }` (204; 400 se a palavra-passe é inválida ou, com `"codigo": "link_invalido"`, se o link é inválido, expirou ou já foi usado). Termina todas as sessões da conta |
| POST | `/api/conta/entrar` | Inicia sessão: `{ "email", "palavraPasse" }` (401 se errado, 403 com `"codigo": "email_por_confirmar"` se falta confirmar o email, 429 depois de 5 falhas seguidas) |
| POST | `/api/conta/sair` | Termina a sessão |
| GET | `/api/conta` | A conta da sessão (401 sem sessão) |
| GET | `/api/jogos/{id}` | Jogo e jogadores das duas equipas (com `convocado`); o `codigo` do link de partilha só vem para o dono, para os outros é `null` *(dono, `?c=` ou jogo aberto a convidados)* |
| GET | `/api/jogos/{id}/estatisticas` | Estado completo (o mesmo que o dashboard recebe) *(dono, `?c=` ou jogo aberto a convidados)* |
| GET | `/api/jogos/{id}/estatisticas/eficacia` | Eficácia com filtros *(dono, `?c=` ou jogo aberto a convidados)* |
| GET | `/api/jogos/{id}/estatisticas/guarda-redes` | Defesas com filtros *(dono, `?c=` ou jogo aberto a convidados)* |
| GET | `/api/jogos/{id}/exportar.xlsx` | Estatísticas em Excel (`?equipaId=` para uma só equipa) *(dono, `?c=` ou jogo aberto a convidados)* |
| WS | `/hub/jogo` | Hub SignalR: `EntrarNoJogo(jogoId, codigo)` (o código pode ser `null` para o dono) e mensagem `EstatisticasAtualizadas` |
| GET | `/api/convidado/jogos-em-direto` | Jogos abertos a convidados, os das últimas 24 horas que o dono não escondeu (aberta, sem `codigo`): `[{ id, dataHora, local, casaNome, foraNome, ultimoEvento, golosCasa, golosFora }]`; `ultimoEvento` é `null` se ainda não há eventos; os que têm eventos vêm primeiro, o mais recente primeiro; no máximo 50 |
| GET | `/api/jogos` | Os jogos da conta, com resultado, `codigo` e `visivelConvidados` |
| PUT | `/api/jogos/{id}/visibilidade` | Mostra ou esconde o jogo na área de convidado: `{ "visivel": true }` (204; 400 sem valor; 404 se não é da conta) |
| POST | `/api/jogos` | Cria um jogo: `{ "casaId", "foraId", "local", "dataHora" }` (local e data opcionais) |
| GET | `/api/jogos/{id}/convocados` | Ids dos jogadores convocados e máximo por equipa |
| PUT | `/api/jogos/{id}/convocados` | Substitui a convocatória: `{ "jogadorIds": [1, 2, ...] }` (máx. 16 por equipa) |
| GET | `/api/equipas` | As equipas da conta, com o número de jogadores e `propria` (`true` na equipa da conta, `false` nos adversários); a da conta vem primeiro |
| POST | `/api/equipas` | Cria uma equipa da conta (um adversário): `{ "nome" }` (409 se já existe uma com esse nome na conta). Se a conta ainda não tem equipa, esta passa a ser a equipa da conta |
| GET | `/api/equipas/{id}/escudo` | O escudo da equipa, como imagem (aberta: é só o símbolo do clube; 404 se não tem). Com `?v=versão` fica um dia na cache do browser; sem ela responde a `If-None-Match` com 304 |
| PUT | `/api/equipas/{id}/escudo` | Põe ou troca o escudo: o corpo é a própria imagem (PNG, JPEG ou WebP, até 200 KB; o tipo é decidido pelos primeiros bytes) → 200 `{ "escudo": versão }` (400 outro formato ou vazio; 413 acima de 200 KB; 404 se a equipa não é da conta) |
| DELETE | `/api/equipas/{id}/escudo` | Tira o escudo (204; 404 se a equipa não é da conta) |
| GET | `/api/equipas/{id}/jogadores` | Plantel (com o número de eventos de cada jogador) |
| POST | `/api/equipas/{id}/jogadores` | Adiciona um jogador: `{ "numero", "nome", "posicao" }` |
| PUT | `/api/jogadores/{id}` | Edita um jogador |
| DELETE | `/api/jogadores/{id}` | Apaga um jogador (409 se tiver eventos) |
| POST | `/api/jogos/{id}/eventos` | Regista um evento |
| DELETE | `/api/jogos/{id}/eventos/{eventoId}` | Apaga um evento |
| PUT | `/api/jogos/{id}/relogio` | O banco diz em que segundo está o relógio: `{ "segundo": 0 a 7200, "aCorrer": true/false }` (204; 400 se faltar algum; 404 se o jogo não é da conta) |
| GET | `/api/tipos-evento` | Tipos de evento disponíveis (aberta) |
| GET | `/api/saude` | Estado da API (aberta) |

Numa defesa podes juntar `"balizaX"` e `"balizaY"` (0 a 100, os dois juntos) com o sítio onde o guarda-redes defendeu; em qualquer outro resultado a API responde 400. O estado das estatísticas devolve `balizaX`, `balizaY` e `balizaZona` em cada remate do mapa e `balizaZona` nos últimos eventos.

Escudos: as listas de equipas e de jogos, o jogo (`GET /api/jogos/{id}`), o estado das estatísticas e a lista da área de convidado trazem a **versão** do escudo de cada equipa (`escudo` nas equipas, `casaEscudo` e `foraEscudo` nos jogos; `null` se não tem) e, na lista da área de convidado, também `casaId` e `foraId`. A versão são os milissegundos da última alteração e vai no endereço da imagem (`/api/equipas/ID/escudo?v=VERSÃO`): quando o escudo muda, o endereço muda e o browser vai buscar o novo. A imagem fica na tabela `escudos` (e não em pastas), por isso entra nas cópias de segurança da base de dados. Não se aceita SVG no servidor (pode trazer scripts): o browser converte-o em PNG antes de o enviar.

Um evento `VERMELHO` (vermelho direto) exige `jogadorId`. O estado das estatísticas traz `sancoes`: um item por jogador com 2 minutos ou vermelho, `{ jogadorId, equipaId, numero, nome, doisMinutos, vermelhos, expulso }`, onde `expulso` é `true` com um vermelho ou 3 «2 minutos» (a regra está na vista `v_sancoes`). A API não impede de registar eventos a um jogador expulso (um engano corrige-se apagando o evento); quem os impede é o banco.

Superioridade numérica: os eventos `SETE_SEIS_INICIO` e `SETE_SEIS_FIM` (da equipa, sem jogador nem coordenadas) marcam o ataque 7×6. O banco avisa o servidor do relógio com `PUT /api/jogos/{id}/relogio` ao arrancar, parar, ajustar ou mudar de parte e de 30 em 30 segundos enquanto corre; o servidor guarda o segundo e se anda (tabela `relogios_jogo`) e só envia aos dashboards os avisos que mudam alguma coisa (se o banco deixar de avisar, o relógio pára ao fim de 3 minutos). O estado das estatísticas traz `relogio` (`{ segundo, aCorrer }`; sem aviso do banco, o segundo do último evento) e `numerica`: `relogioUsado`, `duracaoSegundos` (120), `suspensoes` (cada 2 minutos ou vermelho com `eventoId`, `equipaId`, `jogadorId`, `jogadorNumero`, `tipo` e `segundoJogo`), `seteSeis` (por equipa: `ativo` e `desde`), `eficacia` (por equipa e situação: `remates`, `golos`) e `tempo` (segundos por equipa e situação). Quem calcula tudo isto é `api/HandballScouting.Api/Numerica.cs` (sem base de dados, com testes xUnit); as situações são `SUPERIORIDADE`, `IGUALDADE`, `INFERIORIDADE`, `SETE_SEIS` (a equipa ataca sem guarda-redes) e `BALIZA_VAZIA` (remata contra o 7×6 do adversário). Se o relógio nunca foi usado (todos os eventos a 00:00), `relogioUsado` é `false` e não há eficácia nem tempo.

Treinador-assistente: o estado das estatísticas traz `assistente`: `sugestoes` (até 6, as mais importantes primeiro, cada uma com `id`, `codigo` da regra, `nivel` — `urgente`, `atencao`, `sugestao` ou `info` —, `equipaId` da equipa a quem serve, `titulo` e `detalhe` com os números) e `timeouts` (por equipa: `usados`, `naParte` e `restantes` agora). Os time-outs são os eventos `TIMEOUT` (consulta `timeouts.sql`). Quem calcula tudo é `api/HandballScouting.Api/Assistente.cs` (sem base de dados, com testes xUnit).

Exemplo de remate (precisa do cookie da sessão; aqui guardado com `-c`/`-b`):

```bash
curl -c sessao.txt -X POST http://localhost:8080/api/conta/entrar -H "Content-Type: application/json" \
  -d '{ "email": "tu@exemplo.pt", "palavraPasse": "a-tua-palavra-passe" }'

curl -b sessao.txt -X POST http://localhost:8080/api/jogos/1/eventos -H "Content-Type: application/json" -d '{
  "tipoEvento": "REMATE", "equipaId": 1, "jogadorId": 4, "guardaRedesId": 10,
  "resultado": "GOLO", "situacao": "POSICIONAL", "x": 30, "y": 52, "parte": 1, "segundoJogo": 600
}'
```

## Dados reais

As equipas, jogadores e jogos de `db/init/03_equipas_jogadores.sql` e `04_demo_eventos.sql` são fictícios, só para experimentares. Ficam na primeira conta que for criada (como adversários, e são de há 3 dias: não aparecem na área de convidado). Junta os teus jogadores e cria os teus jogos pelos ecrãs da app (**Equipas** e **Novo jogo**). Se quiseres começar sem os exemplos, apaga esses dois ficheiros antes de criar a base de dados.

## Adicionar um novo tipo de evento

Por exemplo, contabilizar "passes errados". (O «Vermelho direto» foi acrescentado assim, em `db/init/12_expulsoes.sql`.) Os tipos vivem na tabela `tipos_evento`, por isso não é preciso mexer no código: o botão aparece sozinho no banco e a contagem aparece em "Outros eventos" no dashboard.

1. Cria `db/init/15_passe_errado.sql`:
   ```sql
   INSERT INTO tipos_evento (codigo, nome, e_remate, ordem) VALUES ('PASSE_ERRADO', 'Passe errado', FALSE, 7)
   ON CONFLICT (codigo) DO NOTHING;
   ```
2. Numa base de dados que já existe, o serviço `migrar` corre o ficheiro no próximo `docker compose up`, mas só se o repetires sem erro: acrescenta `ON CONFLICT (codigo) DO NOTHING` à instrução. (Os ficheiros `01` a `04` só correm quando a base de dados é criada de raiz.)
3. Faz commit e push: o GitHub Actions volta a validar tudo.

Um tipo com `e_remate = TRUE` seria um evento com posição no mapa, jogador e resultado, e exigiria mudanças nas consultas.

## Testes e CI

```bash
dotnet test api/HandballScouting.sln        # validação, palavras-passe, travão de tentativas, emails de confirmação e de recuperação, exportação para Excel, cadastro, superioridade numérica e treinador-assistente (xUnit)

# SQL: com o PostgreSQL a correr e PGHOST, PGUSER, PGPASSWORD e PGDATABASE definidos
psql -v ON_ERROR_STOP=1 -f db/tests/zonas.sql          # zonas do campo
psql -v ON_ERROR_STOP=1 -f db/tests/convocados.sql     # convocatória
psql -v ON_ERROR_STOP=1 -f db/tests/baliza.sql         # zonas e regras da baliza
psql -v ON_ERROR_STOP=1 -f db/tests/contas.sql         # contas, dono dos dados, sessões e código de partilha
psql -v ON_ERROR_STOP=1 -f db/tests/confirmacao.sql    # confirmação do email (códigos, validade, quem herda os dados de exemplo)
psql -v ON_ERROR_STOP=1 -f db/tests/redefinir.sql      # recuperação da palavra-passe (código de uso único, validade, sessões)
psql -v ON_ERROR_STOP=1 -f db/tests/em_direto.sql      # jogos abertos a convidados (24 horas, jogo escondido, jogo sem eventos)
psql -v ON_ERROR_STOP=1 -f db/tests/equipa_da_conta.sql # uma equipa por conta (criada com a conta, dados de exemplo, contas antigas)
psql -v ON_ERROR_STOP=1 -f db/tests/expulsoes.sql      # sanções (3.º 2 minutos e vermelho direto expulsam, por jogo e por jogador)
psql -v ON_ERROR_STOP=1 -f db/tests/escudos.sql        # escudos das equipas (versão, troca, limites, apagar com a equipa)
psql -v ON_ERROR_STOP=1 -f db/tests/superioridade.sql  # tipos do 7×6 e relógio do jogo guardado no servidor
python3 db/tests/validar_consultas.py                  # todas as consultas contra o esquema

# Frontend (Node 22, sem instalar nada): a leitura das listas de jogadores a partir do texto do OCR e a contagem dos 2 minutos
(cd tests && npm run unidade)
```

Há ainda testes que usam a **API verdadeira** e um browser (pasta `tests/`, ver `tests/README.md`):

- `tests/integracao/integracao.mjs`: percorre a API por HTTP e SignalR (contas, emails de confirmação e de recuperação da palavra-passe lidos na caixa de teste, sessões, a equipa da conta (pedida no registo, `propria` na lista de equipas), isolamento entre contas, link de partilha, jogos abertos a convidados durante 24 horas (lista aberta sem sessão, jogos sem eventos pela hora marcada, acesso sem link, código escondido, jogo escondido pelo dono), estatísticas, equipas, jogadores, jogos, convocatória, eventos, local das defesas na baliza, sanções e expulsões (3.º 2 minutos, vermelho direto, apagar para corrigir), superioridade numérica (relógio do banco no servidor, sanções, 7×6, eficácia e tempo por situação), treinador-assistente (sugestões, time-outs e direitos por parte), escudos (permissões, formatos, limite de 200 KB, cache, versão nas listas), atualizações em tempo real e descarga do Excel);
- `tests/integracao/verificar_excel.py`: abre os `.xlsx` descarregados e confere os números com os dados de exemplo;
- `tests/e2e/fluxos.mjs`: abre as páginas num Chromium e usa-as como um utilizador (criar conta, confirmar o email pelo link, reenviar o email, recuperar a palavra-passe pelo link, a página que só mostra a equipa da conta, criar um jogo escrevendo o adversário, a área de convidado e a lista de jogos das últimas 24 horas (incluindo esconder um jogo), sair e entrar, uma segunda conta que não vê os dados da primeira, o link de partilha aberto sem conta, juntar jogadores à equipa, convocatória (incluindo ler a lista de uma foto com o leitor verdadeiro), registar remates no banco, expulsar jogadores (3.º 2 minutos e vermelho direto) e ver o quadro de sanções, contar os 2 minutos com o relógio a andar (faixa 6×5, 7×6, relógio no dashboard) e ver a eficácia por situação, ver as sugestões do treinador-assistente (só o dono) e gastar time-outs no banco, carregar, trocar e tirar o escudo da equipa (a imagem é reduzida no browser) e vê-lo no placar, nas listas e na área de convidado, marcar na baliza onde o guarda-redes defendeu e vê-los chegar ao dashboard por WebSocket, descarregar o Excel).

O workflow `.github/workflows/ci.yml` corre em cada push para `main` e em cada pull request:

1. **API**: restaura, compila e corre os testes .NET.
2. **Base de dados**: cria o esquema num PostgreSQL temporário, carrega os dados, corre `db/tests` e valida as consultas.
3. **Integração**: corre os testes unitários do frontend, publica e arranca a API contra um PostgreSQL temporário e uma caixa de correio de teste (Mailpit) e corre os testes de `tests/` (API, Excel e browser). As capturas de ecrã e os `.xlsx` gerados ficam disponíveis como artefacto da execução (`resultados-integracao`).
4. **Docker**: valida o `docker-compose.yml` e compila as imagens da API e do frontend. Em `main`, publica-as no GitHub Container Registry (`ghcr.io/<utilizador>/<repositório>/api` e `/frontend`).

## Limitações atuais

- Se a rede falhar no momento de registar, o evento **não** fica em fila: aparece um aviso e é preciso tocar outra vez.
- O registo de contas é aberto (com confirmação do email). Se a app ficar acessível na internet, põe-na atrás de HTTPS (o cookie da sessão passa a `Secure` sozinho quando o proxy envia `X-Forwarded-Proto: https`).
- A leitura de fotos é feita por OCR: lê bem texto impresso e prints, mas pode trocar letras, perder acentos ou juntar palavras, e a letra manuscrita raramente se lê. Há sempre uma lista para rever antes de confirmar. Num telemóvel antigo a leitura pode demorar alguns segundos.
- Quem tem o link de partilha de um jogo vê-o em direto até o jogo ser apagado: não há botão para mudar o código.
- Como o registo é aberto, os jogos de **qualquer conta** aparecem na área de convidado durante 24 horas (mesmo sem eventos, a partir da hora do jogo). Quem não quiser mostrar um jogo desliga *Mostrar na área de convidado* (o jogo continua visível para quem tiver o link). Quem tem sessão e abre um jogo de outra conta (aberto a convidados) só o vê, não o pode mexer.
- A lista de jogos da área de convidado fica só no browser de cada dispositivo (não acompanha o convidado para outro).
- O estado completo é recalculado e enviado a cada evento. Para um jogo de andebol (algumas centenas de eventos) é muito rápido.

## Estrutura

```
api/                   API ASP.NET Core (Program.cs, SignalR, consultas em Sql/, Excel/) e testes xUnit
db/init/               esquema, dados base, equipas/jogadores, demo, convocatória, baliza, contas, confirmação do email, recuperação da palavra-passe, jogos abertos a convidados, equipa da conta, expulsões, escudos e superioridade numérica (correm por ordem)
db/tests/              testes SQL
frontend/              páginas (entrar, confirmar email, redefinir palavra-passe, convidado, jogos, equipas, convocatória, banco, dashboard), JS, CSS e fontes; lib/ tem o cliente SignalR e o leitor de imagens (Tesseract)
tests/                 testes de integração da API, do Excel e de browser (Node + Playwright)
docker-compose.yml     os 3 contentores (mais o `migrar`, que atualiza a base de dados em cada arranque)
.github/workflows/     CI
```
