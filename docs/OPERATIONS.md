# Operações — Caçador de Ofertas

Runbook de operação da Etapa A (coletor). Cobre variáveis de ambiente, os
dois jobs de cron, como aplicar migration, o que fazer quando o canário
acende, e a profundidade real do arquivo por canal medida no backfill
inicial.

## Variáveis de ambiente

Nenhum valor abaixo é impresso aqui — só os nomes e onde obter cada um.

| Variável | Onde obter | Uso |
|---|---|---|
| `SUPABASE_URL` | Painel do Supabase → Project Settings → API → Project URL | Requerida pelo coletor (`lib/env.ts`) e pelos scripts em `scripts/` |
| `SUPABASE_SERVICE_ROLE_KEY` | Painel do Supabase → Project Settings → API → `service_role` secret | Requerida pelo coletor; nunca expor no client, só em rota de servidor/script |
| `CRON_SECRET` | Gerado localmente (string aleatória forte); o mesmo valor vai na env da Vercel e no header `x-cron-secret` configurado no scheduler externo | Requerida pelo coletor — autentica `POST /api/cron/*` (`lib/cron/auth.ts`) |
| `TELEGRAM_BOT_TOKEN_OFERTAS` | BotFather no Telegram (`/newbot` ou token de bot existente) | Reservada para o bot conversacional (Etapa C) — não usada pelo coletor ainda |
| `ALLOWED_CHAT_IDS` | `chat_id` do Telegram do usuário autorizado (ex.: via `@userinfobot` ou `getUpdates`) | Reservada para a allowlist do bot (Etapa C) — não usada pelo coletor ainda |

As três primeiras (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`)
são as únicas que `readEnv()` exige hoje; sem elas o processo derruba com
"Variáveis de ambiente faltando".

## Jobs de cron

Dois jobs, ambos `POST`, com header `x-cron-secret: <valor de CRON_SECRET>`:

| Rota | Frequência | Observação |
|---|---|---|
| `/api/cron/tick` | a cada 5 min | coleta incremental por canal (`ingestAll`); acende o canário (ver abaixo) se **todos** os canais devolverem zero posts na mesma rodada |
| `/api/cron/backfill` | a cada 10 min | avança uma página por canal por invocação, deliberadamente devagar pra não martelar o `t.me`; vira no-op quando `backfill_complete = true` em todos os canais |

Pendente (fora do escopo desta task, exige login interativo do humano):
agendar os dois jobs no cron-job.org e configurar as env vars + deploy na
Vercel.

## Como rodar uma migration

As migrations ficam em `supabase/migrations/`, numeradas (`0001_...`,
`0002_...`, ...). Não existe runner automático neste projeto — cada arquivo
é colado manualmente no **SQL Editor do Supabase** e executado, **em ordem
numérica, um de cada vez**. Nunca pular um número nem rodar fora de ordem.

Exceção registrada: `0002_seed_channels.sql` foi aplicada nesta task via
`scripts/seed-channels.mjs` (usa `@supabase/supabase-js` com a
`service_role`, `upsert` com `onConflict: "slug"` e `ignoreDuplicates:
true`) em vez do SQL Editor — mesmo efeito de `on conflict do nothing`,
seguro pra rodar de novo (idempotente).

## Quando `/api/cron/tick` devolve 500 com `CANÁRIO`

Se o log do servidor mostrar `CANÁRIO: nenhum canal devolveu post` e a
resposta JSON trouxer `"allEmpty":true`, significa que **todos** os canais
retornaram zero posts na mesma rodada — não é um canal fora do ar, é sinal
de que o `t.me` mudou o HTML da página pública do canal e o parser parou de
reconhecer os posts.

Como corrigir:

1. Baixar o HTML atual de `https://t.me/s/<slug>` de qualquer canal do seed.
2. Rebaixar (atualizar) as fixtures em `tests/fixtures/*.html` com o HTML novo.
3. Rodar `pnpm test` — os testes de `tests/collector/parse.test.ts` devem
   falhar, apontando o que mudou (âncora `data-post`, classe
   `tgme_widget_message_text`, atributo `datetime` do `<time>`, etc.).
4. Corrigir os regex/seletores em `lib/collector/parse.ts` até os testes
   passarem de novo.
5. Redeployar e chamar `/api/cron/tick` manualmente pra confirmar
   `"allEmpty":false`.

## Razões de parada do backfill e o que fazer

`decideBackfill` (`lib/cron/backfill.ts`) produz quatro razões de parada por
canal, por invocação. Só uma delas é falha real; as outras três são término
normal do arquivo daquele canal:

| Razão | `backfill_complete` vira `true`? | Isso é falha? | O que o operador vê | Ação |
|---|---|---|---|---|
| `"página vazia"` | sim | Não — fim de arquivo | Página sem nenhuma âncora `data-post`: chegou no fim real do histórico do canal. Log `"<slug>: 0 posts, página vazia"`; HTTP 200 | Nenhuma |
| `"passou da janela"` | sim | Não — janela cumprida | Página trouxe posts, mas o mais antigo já é anterior à janela de 6 meses (`oldestAllowedFrom`). Log `"<slug>: N posts, passou da janela"`; HTTP 200 | Nenhuma |
| `"cursor travado"` | sim | Não, o código não trata como falha (`broken: false`) — mas é o sinal mais fraco dos três | Página trouxe posts, mas o post mais antigo repete o `postId` do cursor anterior: a paginação do `t.me` parou de andar antes de alcançar a janela de 6 meses. Log `"<slug>: N posts, cursor travado"`; HTTP 200 | Nenhuma automática. Se quiser confirmar: olhe o post mais antigo salvo do canal — se for razoável que o canal tenha menos de 6 meses de histórico publicado, é isso mesmo. O código não distingue "canal genuinamente raso" de "bug de paginação do `t.me` que nunca avançou" — os dois terminam do mesmo jeito, `backfill_complete = true` |
| `"parser quebrado"` | **não** | **Sim — quebra** | Página trouxe âncoras `data-post` (os posts existem), mas `parseChannelPage` extraiu zero: o `t.me` mudou a marcação interna da mensagem, não é fim de arquivo. Cursor **não avança**, `backfill_complete` **não muda**. Log `"CANÁRIO: parser quebrado no backfill"` com os reports; **HTTP 500** | Ação imediata — mesmo procedimento do canário do tick (seção acima): atualizar as fixtures de `tests/fixtures/`, rodar `pnpm test` pra ver o que quebrou, corrigir os seletores em `lib/collector/parse.ts` |

Existe ainda um quinto caso fora de `decideBackfill`: exceção de rede ou do
Postgres dentro do `try/catch` de `backfillOnce`, reportada com razão
`"erro"` e `reports[].error` preenchido. Não atualiza `backfill_cursor` nem
`backfill_complete` para aquele canal. A rota só devolve HTTP não-200 por
causa disso se **nenhum** canal do lote tiver sido processado com sucesso
(`summary.noneOk`, log `"Backfill: nenhum canal processado com sucesso"`,
HTTP 500) — se 1 de N canais errou e os outros seguiram normalmente, a
resposta ainda é 200 e o único jeito de notar é inspecionar `reports[].error`
no JSON.

## Nota sobre contagem no Supabase (PostgREST)

Ao consultar contagens via `@supabase/supabase-js`/PostgREST, use sempre
`{ count: "exact" }` (equivalente ao header `Prefer: count=exact`). A
resposta padrão do PostgREST **corta em 1000 linhas** — contar `data.length`
de uma consulta comum, ou não pedir `count: "exact"`, subestima
silenciosamente qualquer tabela com mais de 1000 linhas. Isso já produziu
um diagnóstico errado nesta mesma sessão de medição. Quem operar depois:
**sempre `count: "exact"`** pra qualquer número que vá em relatório ou
decisão.

## Profundidade real do arquivo por canal

Medida rodando `/api/cron/backfill` repetidamente contra o Supabase de
produção, em 2026-08-07, e conferida com `count: "exact"` (ver nota acima).
Era desconhecida até essa medição — é a entrada que a Etapa B (busca
histórica) usa pra decidir ranqueamento.

A janela-alvo do backfill é 6 meses; nesta data isso corresponde a
`>= 2026-02-07`. Canais marcados `backfill_complete = true` já pararam
exatamente nessa borda (ou um pouco além dela, no último lote que a
ultrapassou).

| canal | `backfill_complete` | posts | com_preço | com_loja | post mais antigo |
|---|---|---:|---:|---:|---|
| `gtOFERTAS` | **não** — em progresso | 3.183 | 3.140 | 3.148 | 2026-07-16 |
| `Chinacuponsbr` | **não** — em progresso | 3.180 | 2.977 | 3.161 | 2026-03-15 |
| `AliexpresspromocoesecuponsBR` | sim | 2.719 | 2.611 | 2.706 | 2026-02-07 |
| `jgtechofertas` | sim | 2.010 | 1.774 | 1.794 | 2026-02-06 |
| `TudoPromo` | sim | 1.860 | 1.859 | 614 | 2026-02-06 |
| `ctofertascelulares` | sim | 1.693 | 1.178 | 877 | 2026-02-05 |
| `CuponsAliExpressChinaCuponsBR` | sim | 159 | 146 | 159 | 2026-01-20 |

**TOTAL: 14.804 posts** (medido em 2026-08-07).

Observações:

- **Cinco canais completaram** o backfill da janela de 6 meses nesta sessão.
  `CuponsAliExpressChinaCuponsBR` é o mais raso de todos (159 posts,
  arquivo real até 2026-01-20) — não é falha, é o volume de postagem real
  desse canal; ele passou da borda da janela naturalmente ("passou da
  janela"), não travou.
- `ctofertascelulares` — o canal que só usa encurtador de link próprio
  (`canalte.ch`) — tem `com_loja = 877` de 1.693 posts, comprovando que o
  fallback de detecção de loja por texto (não só por domínio) funciona de
  ponta a ponta contra dado real.
- **Dois canais de altíssimo volume ainda não completaram**: `gtOFERTAS`
  (~145 posts/dia; precisaria recuar mais uns 5 meses até a borda da janela)
  e `Chinacuponsbr` (mais perto — faltam cerca de 5 semanas de janela, mas
  ainda um volume grande de páginas). Ver a seção seguinte sobre por que
  isso é esperado.

## Backfill leva dias, e tudo bem

O backfill roda **uma página por canal por invocação, de propósito** — é o
jeito de não martelar o `t.me` com muitas requisições seguidas
(`lib/cron/backfill.ts`). Isso é uma escolha deliberada de design, não uma
limitação a "otimizar" depois.

Pra um canal de baixo/médio volume (a maioria dos 7 do seed), a janela de 6
meses cabe em algumas dezenas de invocações — completa rápido. Mas
`gtOFERTAS` posta na faixa de **~145 itens/dia**; recuar 6 meses inteiros
nesse canal significa em torno de **1.150+ páginas**, ou seja, 1.150+
invocações de `/api/cron/backfill` só pra esse canal. Com o job agendado a
cada 10 minutos em produção, isso é da ordem de **vários dias** de
execução contínua até `backfill_complete` virar `true` nele.

**Isso é o comportamento esperado, não um defeito.** Sinais de que está
tudo normal, mesmo com `backfill_complete = false` por dias:

- o `backfill_cursor` do canal muda a cada invocação (está avançando);
- o log de cada rodada mostra `"N posts, continua"` pro canal, não erro;
- `/api/cron/tick` continua devolvendo `allEmpty: false` normalmente — o
  backfill (arquivo histórico) e o tick (coleta do que é novo) são
  independentes; um não bloqueia o outro.

**Não existe um estado real de `backfill_cursor` parado com `backfill_complete
= false`** — quando a paginação do `t.me` para de andar sem quebra de parser,
`decideBackfill` já marca `backfill_complete = true` sozinho, na hora (razão
`"cursor travado"`, ver tabela na seção "Razões de parada do backfill e o que
fazer" abaixo). Não fica parado esperando investigação; procurar por esse
sinal é procurar o estado errado.

O sinal que de fato exige ação humana durante o backfill é a resposta
**HTTP 500** com `"CANÁRIO: parser quebrado no backfill"` no log — significa
que o `t.me` mudou o HTML e o parser parou de extrair posts, e por isso o
código propositalmente **não** avança o cursor nem marca `backfill_complete`
(ver tabela abaixo, razão `"parser quebrado"`). É esse status HTTP e essa
linha de log que valem monitorar, não o comportamento do cursor.

## Pendências desta etapa

- **Deploy na Vercel** (Step 5 do plano): importar `JaoVile/VaiGerar`,
  configurar `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` em
  Settings → Environment Variables, e confirmar que
  `curl -X POST https://<app>.vercel.app/api/cron/tick` sem header devolve
  401. Exige login interativo do humano na Vercel — não executado nesta task.
- **Agendamento no cron-job.org** (Step 6 do plano): criar os dois jobs da
  tabela acima. Exige login interativo do humano — não executado nesta task.
- **Backfill de `gtOFERTAS` e `Chinacuponsbr` ainda não completou** — ver
  "Backfill leva dias, e tudo bem" acima. Não precisa de ação manual:
  continuará avançando sozinho a cada invocação de `/api/cron/backfill`
  (a cada 10 min, uma vez agendado em produção) até `backfill_complete =
  true` nos dois.

## Bot do Telegram (Etapa C)

### Primeiro deploy do bot — ordem obrigatória

**Faça nesta ordem.** Cada passo depende do anterior; a seção inteira abaixo
é referência, não roteiro. O ponto que não pode ser invertido é o 2: o bot só
pode abrir para o usuário **depois** do reprocessamento de preços.

1. **Rodar a migration `0004_alerts_claimed_at.sql`** no SQL Editor do
   Supabase (ver "Como rodar uma migration"). Sem a coluna `claimed_at` a
   entrega de alerta falha em silêncio — o erro fica preso no `try/catch` do
   tick e o sintoma é "alerta nunca chega", sem nenhum HTTP não-200.
2. **Reprocessar os preços até o fim**: laço de `POST /api/cron/reprocess?desde=<proximo>`
   até a resposta trazer `"fim": true` (ver "Reprocessamento de preços de posts
   antigos" mais abaixo, com o `curl`). **Confira `mudados`/`pulados` do
   primeiro lote antes de disparar o resto do laço.**
   **Por que antes de abrir o bot:** os ~15 mil posts já arquivados foram
   gravados com o parser antigo, que confundia valor de cupom com preço do
   produto. Enquanto não forem reprocessados, `price_cents` está errado para
   boa parte do arquivo — e é exatamente esse campo que o `/agora` mostra, que
   alimenta a mediana ancorando o preço-alvo do `/cacar`, e que o casamento de
   caça compara contra a faixa. Abrir o bot antes significa a primeira busca
   do usuário mostrar valor de cupom como se fosse preço, e caça criada em
   cima de uma mediana falsa. É a primeira impressão do produto, e não dá para
   desfazer depois.
3. **Validar com um `/agora` de amostra** (pode ser via `curl` no `sendMessage`
   ou já com o webhook em ambiente de teste): escolher um produto conhecido e
   conferir se menor preço e mediana batem com a realidade do mercado. Preço
   suspeito de "R$ 10,00" para celular é cupom não reprocessado — volte ao
   passo 2 antes de seguir.
4. **Configurar as variáveis do bot na Vercel** (`TELEGRAM_BOT_TOKEN_OFERTAS`,
   `TELEGRAM_WEBHOOK_SECRET`, `ALLOWED_CHAT_IDS`) **e redeployar** — variável
   nova só vale para deploy feito depois dela.
5. **Registrar o webhook** com `setWebhook` (ver "Como registrar o webhook").
   Este é o passo que abre o bot para o usuário; deixe-o por último.

O bot conversacional (`@Vaigerarviubot`) roda como mais uma rota da mesma
aplicação Next.js — não é um processo separado. Recebe updates do Telegram
via webhook (`app/api/telegram/webhook/route.ts`), interpreta comandos em
`lib/bot/router.ts` (`/ajuda`, `/agora`, `/cacar`, `/cacas`, texto livre) e
guarda o estado da conversa de criação de caça em `lib/bot/session.ts`
(tabela `bot_sessions`, expira em 10 minutos sem uso). A entrega de alerta
roda dentro do `/api/cron/tick` existente, em `lib/cron/alerts.ts` — não é um
job novo.

### Variáveis de ambiente do bot

Mesma regra da tabela acima: só nomes e onde obter, nenhum valor aqui.

| Variável | Onde obter | Uso |
|---|---|---|
| `TELEGRAM_BOT_TOKEN_OFERTAS` | BotFather no Telegram, token do `@Vaigerarviubot` (`/newbot` ou token já existente) | Autentica as chamadas à API do Telegram (`sendMessage`, `answerCallbackQuery`, `setWebhook`) |
| `TELEGRAM_WEBHOOK_SECRET` | Gerado localmente (ex.: `openssl rand -hex 32`); o mesmo valor precisa estar em três lugares — `.env.local`, env da Vercel e no `secret_token` passado ao `setWebhook` | Comparado contra o header `x-telegram-bot-api-secret-token` em cada requisição recebida no webhook — é o que impede qualquer terceiro de forjar updates |
| `ALLOWED_CHAT_IDS` | `chat_id` de cada usuário autorizado a falar com o bot (via `@userinfobot` ou `getUpdates`), lista separada por vírgula | Allowlist checada em `autorizado()` (`lib/bot/router.ts`); `parseChatIds()` em `lib/env.ts` faz o split, **loga um `console.warn` por entrada descartada** e **lança** se nenhuma entrada for um id válido — lista presente e toda inválida é erro de configuração, não "ninguém autorizado" |

`TELEGRAM_BOT_TOKEN_OFERTAS` e `ALLOWED_CHAT_IDS` já apareciam na tabela de
variáveis lá em cima, reservadas para esta etapa — a partir de agora estão
de fato em uso.

**`readEnv()` e `readBotEnv()` são funções separadas em `lib/env.ts` de
propósito**, cada uma com sua própria lista de variáveis obrigatórias:
`readEnv()` exige só `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e
`CRON_SECRET` — o que o coletor precisa. `readBotEnv()` exige as três
variáveis do bot acima, e só é chamada dentro das rotas do bot e no trecho
de alertas do tick. Se faltar uma variável do bot na Vercel, `readBotEnv()`
lança, mas isso nunca derruba a coleta: o webhook devolve 200 mesmo assim
(ver abaixo) e, dentro de `/api/cron/tick`, a chamada a `readBotEnv()` está
dentro do mesmo `try/catch` que envolve `processarAlertas` — o erro é
logado, `alertas` fica com os contadores zerados, e a resposta da rota
continua 200 com o resultado normal da ingestão. Bot mal configurado é
problema do bot, não do coletor.

### Como registrar o webhook

O `setWebhook` precisa ser chamado uma vez (de novo só se o token ou o
secret mudarem, ou se a URL de deploy mudar). Lendo o token e o secret do
`.env.local` em vez de colar valor na linha de comando — assim nenhum
segredo fica no histórico do shell nem em log:

```bash
TOKEN=$(grep '^TELEGRAM_BOT_TOKEN_OFERTAS=' .env.local | cut -d= -f2-)
WH=$(grep '^TELEGRAM_WEBHOOK_SECRET=' .env.local | cut -d= -f2-)
curl -s -X POST "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -H "content-type: application/json" \
  -d "{\"url\":\"https://<app>.vercel.app/api/telegram/webhook\",\"secret_token\":\"${WH}\",\"allowed_updates\":[\"message\",\"callback_query\"]}"
```

Resposta esperada: `{"ok":true,"result":true,...}`.

Para conferir que ficou registrado (sem expor segredo nenhum — a resposta
de `getWebhookInfo` não devolve o `secret_token`):

```bash
curl -s "https://api.telegram.org/bot${TOKEN}/getWebhookInfo"
```

Confira a `url` e o `pending_update_count` — se estiver crescendo em vez de
ficar baixo, é sinal de que o webhook está devolvendo erro (ver diagnóstico
abaixo) e o Telegram está reenfileirando.

### Diagnóstico do bot

| Sintoma | Causa real | O que fazer |
|---|---|---|
| **Webhook devolve 401** | `TELEGRAM_WEBHOOK_SECRET` divergente entre a env da Vercel e o `secret_token` passado ao `setWebhook`. A rota (`app/api/telegram/webhook/route.ts`) compara o header `x-telegram-bot-api-secret-token` contra `env.telegramWebhookSecret` e devolve 401 no primeiro descasamento — antes de tocar em qualquer outra coisa | O valor precisa ser **idêntico** nos três lugares: `.env.local`, env da Vercel (com redeploy feito depois de setar) e o `secret_token` da chamada de `setWebhook`. Se algum foi trocado depois, os outros dois ficaram para trás — refaça o `setWebhook` com o valor atual |
| **Bot fica mudo, sem erro nenhum** | `chat_id` fora de `ALLOWED_CHAT_IDS` — mas confira primeiro o log: `ALLOWED_CHAT_IDS: entrada descartada` (uma linha por entrada que não é número) aponta erro de digitação na variável, e se **nenhuma** entrada for válida `readBotEnv()` lança e o log traz `Bot mal configurado` (o webhook segue devolvendo 200, então o sintoma continua sendo silêncio). Fora esses casos, o chat é mesmo de fora da lista. A rota do webhook devolve **200 de propósito** nesse caso (`autorizado()` retorna `false`, e o corpo do `if` que chama `tratar()` simplesmente não roda) — devolver 401 ou 403 faria o Telegram reenfileirar o mesmo update para sempre, então a falha é silenciosa por desenho, não por bug | Confira se o `chat_id` de quem está testando está na lista de `ALLOWED_CHAT_IDS` (lembre que é lista separada por vírgula, sem espaço à parte não faz diferença — `parseChatIds` dá `trim()`) |
| **Comandos respondem, mas alerta nunca chega** | A migration `0004_alerts_claimed_at.sql` não foi aplicada — falta a coluna `claimed_at` em `alerts`. `processarAlertas` (`lib/cron/alerts.ts`) usa essa coluna no `select` e no `.or()` do lease de claim; sem ela, a query falha. O erro fica **contido no `try/catch`** de `/api/cron/tick` em volta de `processarAlertas` — é logado, mas não interrompe a rota, então o tick continua devolvendo 200 e a coleta segue normal. É por isso que não aparece como "erro" nenhum lugar óbvio | Rode a migration `0004` no SQL Editor do Supabase (ver seção seguinte) |
| **Alerta chega duplicado, ocasionalmente** | Um tick morreu (em geral por estourar o `maxDuration` de 60s, não crash) depois do `sendMessage` chegar ao Telegram e antes de gravar `sent_at`; o lease de claim (2 min, menor que o intervalo de 5 min do tick) libera a linha e o tick seguinte reenvia. `ORCAMENTO_ENTREGA_MS` (35s, `lib/cron/alerts.ts`) reduz muito a chance disso: `processarAlertas` para de **iniciar** novos envios depois de 35s de processamento e deixa o resto pendente pro próximo tick — o JSON do tick devolve isso em `alertas.adiados`. **Não elimina a causa**: é mitigação de janela, não remove o risco de morte de processo entre o envio e o `sent_at` por outro motivo qualquer, nem garante matematicamente o pior caso absoluto (ingest e o envio em voo no momento do corte, ambos no teto de latência, ainda somam mais que 60s) | Não é um bug pra corrigir — é o trade-off documentado (`docs/FOLLOW-UPS.md`, "Entrega duplicada de alerta"): repetir alerta é preferível a perder. Se a frequência incomodar, as saídas descartadas por ora (reduzir timeout de envio, aumentar o lease) estão registradas no mesmo lugar |
| **Caça criada que nunca dispara** | `terms_none` contém alguma palavra que também está em `terms_any` — e `casa()` (`lib/hunts/match.ts`) checa o veto (`termsNone`) **antes** dos termos obrigatórios (`termsAny`): se as duas listas tiverem sobreposição, a condição de veto sempre bate primeiro e a caça nunca casa com nenhum post, para sempre, sem erro nenhum | `criarHunt` (`lib/bot/hunts-repo.ts`) já filtra isso: `proibidosPara()` remove da lista padrão de proibidos (capa, película, carregador, cabo, suporte, seminovo etc.) qualquer palavra que apareça no próprio produto buscado — então uma caça criada pelo fluxo normal do bot não cai nessa. O risco é caça inserida direto por SQL manual, sem passar por `criarHunt`: confira se `terms_none` e `terms_any` não compartilham nenhum termo |

### Reprocessamento de preços de posts antigos (`/api/cron/reprocess`)

A Task 2 corrigiu o parser de preço (`lib/parse/price.ts`) para não tratar
valor de cupom como preço do produto. Essa correção só vale **daqui para a
frente** — os cerca de 15 mil posts já gravados antes da correção mantêm o
`price_cents` errado (valor de cupom) até serem reprocessados. É para isso
que existe `/api/cron/reprocess`: reaplica o parser atual sobre posts já
salvos e atualiza `price_cents`/`prices_cents` quando o resultado muda.

Autenticada como as outras rotas de cron (header `x-cron-secret`). Roda em
lotes de 500 posts, em ordem crescente de `id`, e é **retomável por
cursor**: cada chamada aceita `?desde=<id>` e a resposta devolve `proximo`
com o `id` do último post lido do lote — passe esse valor como `desde` na
próxima chamada. `fim: true` na resposta indica que o lote leu menos que
500 linhas, ou seja, chegou ao fim da tabela.

```bash
curl -s -X POST "https://<app>.vercel.app/api/cron/reprocess?desde=0" \
  -H "x-cron-secret: <valor de CRON_SECRET>"
# repita com desde=<proximo> da resposta anterior, até "fim": true
```

**Confira o primeiro lote antes de continuar o laço** — olhe `mudados` e
`pulados` na resposta e, se possível, alguns posts que mudaram, antes de
disparar as chamadas seguintes em sequência. É a única chance barata de
pegar um parser que regrediu antes de rodar contra as ~15 mil linhas
inteiras.

O campo **`pulados`** conta posts em que o parser atual não achou preço
nenhum (`priceCents: null`) num post que antes tinha um valor salvo. A rota
**nunca sobrescreve um preço existente com `null`** (`decideReprocesso` em
`lib/cron/reprocess.ts`) — perder um preço é decisão consciente do
operador, não efeito colateral silencioso do reprocessamento. Um `pulados`
alto pode ser regressão do parser (investigar) ou só post atípico sem preço
de verdade no texto (esperado, nada a fazer).

## Migrations pendentes

A `0004_alerts_claimed_at.sql` (adiciona a coluna `claimed_at` em `alerts`
e o índice parcial `alerts_pendentes_idx`) **ainda não foi rodada em
produção** e precisa ser colada manualmente no **SQL Editor do Supabase**,
seguindo o mesmo processo descrito em "Como rodar uma migration" acima.

Sem ela: `processarAlertas` falha ao consultar `alerts` (a coluna não
existe), o erro é engolido pelo `try/catch` do `/api/cron/tick` em volta da
etapa de alertas, e o sintoma observável é exatamente o descrito acima em
"Comandos respondem, mas alerta nunca chega" — sem nenhum HTTP não-200 para
apontar o problema.
