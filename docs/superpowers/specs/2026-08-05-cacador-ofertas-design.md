# Caçador de Ofertas — design

**Data:** 2026-08-05
**Stack:** Next.js 15 (App Router, TypeScript) na Vercel + Supabase Postgres + bot do Telegram
**Escopo:** os quatro subsistemas num spec só, sequenciados em quatro etapas

---

## 1. Problema

Canais de oferta no Telegram despejam centenas de posts por dia. Duas necessidades:

1. **Vigilância** — "me avisa quando sair um Galaxy S25+ por ~R$3.000".
2. **Pesquisa** — "quanto costuma custar uma calça de academia? me mostra as melhores dos últimos meses".

Hoje as duas exigem rolar o feed na mão e confiar na memória sobre o que é preço bom.

## 2. O que o sistema faz

- Coleta continuamente os posts dos canais monitorados e guarda num arquivo pesquisável.
- Faz backfill do histórico já existente nos canais (não espera meses acumulando).
- Extrai preço, loja e link de cada post.
- Responde busca em texto livre pelo bot, com estatística de preço (mínimo, mediana) do período.
- Mantém "caças": alvo de produto + preço, configuradas por conversa guiada, que disparam alerta quando aparece post na faixa.

## 3. Decisões-chave

| Decisão | Escolha | Por quê |
|---|---|---|
| Fonte dos dados | Scraping de `t.me/s/<canal>` | Canais públicos expõem HTML sem autenticação. Bot do Telegram **não consegue** ler canais que não administra, e userbot (MTProto) exigiria a sessão da conta pessoal em produção — risco desnecessário. |
| Faixa de preço | `alvo ±5%` (ajustável por caça) | Generaliza pra qualquer produto e mata acessório de brinde: capa de R$29 nunca cai na faixa de um aparelho de R$3.000. Substitui lista negra de palavras, que precisaria de manutenção eterna. |
| Onde roda | Vercel + Supabase | Bot conversacional exige endpoint HTTP escutando — cron puro (GitHub Actions) não sustenta conversa. Postgres dá full-text search em português de graça. Stack já dominada. |
| Agendamento | cron-job.org → rota autenticada | Vercel Hobby limita crons nativos; scheduler externo com header `x-cron-secret` é o padrão já usado no Touvie. |
| Autenticação | Allowlist de `chat_id` | Sistema mono-usuário. Supabase Auth e RLS seriam peso morto. |
| Interface | Só o bot, sem UI web | YAGNI. Se gerenciar caça pelo chat incomodar, aí se avalia uma tela. |
| Coleta e alerta | Mesma invocação (`/api/cron/tick`) | Elimina corrida entre "post inserido" e "caça lê o post". Um job, um cursor, sem coordenação. |

### Extração de preço — o ponto mais traiçoeiro

Post típico:

```
Galaxy S25+ 256GB
De R$ 4.199,00 por R$ 3.299,00 à vista no Pix
ou 12x de R$ 274,91
```

Três armadilhas, todas obrigatórias no parser:

1. **Preço riscado** (`<s>`/`<del>` no HTML) é o preço velho — descartar **antes** de extrair. Por isso o parser trabalha sobre o HTML, não sobre texto puro.
2. **Parcela** (`12x de R$ 274,91`) — descartar valores precedidos de `\d+\s*x\s*(de)?` numa janela curta. Sem isso, um `min()` ingênuo dispara alerta com o valor da parcela.
3. **Formato BR** — `4.199,00` → `419900` centavos. Ponto é milhar, vírgula é decimal.

Resultado: `prices_cents[]` com todos os candidatos válidos (auditoria) e `price_cents` = menor deles (o preço Pix, que é o real).

### Detecção de loja

Por domínio do link, incluindo encurtadores conhecidos (`amzn.to` → Amazon, `s.shopee.com.br` → Shopee, `mercadolivre.com`/`mlb.la` → Mercado Livre, `aliexpress`/`s.click.aliexpress` → AliExpress, `magazineluiza`/`magazinevoce` → Magalu). **Encurtador não é resolvido via HTTP** — seria uma requisição extra por post na ingestão, custo alto pra ganho baixo. Domínio desconhecido grava `store = null`.

## 4. Modelo de dados

```sql
-- Canais monitorados
channels (
  slug              text primary key,        -- 'ctofertascelulares'
  title             text,
  kind              text not null,           -- 'tech' | 'china'  → decide qual bot alerta
  is_active         boolean not null default true,
  last_post_id      bigint not null default 0,   -- cursor da coleta pra frente
  backfill_cursor   bigint,                      -- cursor do backfill pra trás (null = não iniciado)
  backfill_complete boolean not null default false,
  created_at        timestamptz not null default now()
)

-- Arquivo de posts
posts (
  id             bigserial primary key,
  channel_slug   text not null references channels(slug),
  post_id        bigint not null,          -- id dentro do canal
  posted_at      timestamptz not null,
  text           text not null,
  url            text not null,
  price_cents    integer,                  -- menor preço válido (null = não achou)
  prices_cents   integer[] not null default '{}',
  store          text,
  product_url    text,
  search_vector  tsvector generated always as (to_tsvector('portuguese', text)) stored,
  created_at     timestamptz not null default now(),
  unique (channel_slug, post_id)
)
create index posts_search_idx  on posts using gin(search_vector);
create index posts_posted_idx  on posts (posted_at desc);
create index posts_price_idx   on posts (price_cents) where price_cents is not null;

-- Caças
hunts (
  id               uuid primary key default gen_random_uuid(),
  chat_id          bigint not null,
  bot_key          text not null default 'ofertas',   -- 'ofertas' | 'china'
  label            text not null,
  query            text not null,           -- o que o usuário digitou, cru
  terms_any        text[] not null,         -- variantes que satisfazem
  terms_all        text[] not null default '{}',
  terms_none       text[] not null default '{}',
  target_cents     integer not null,
  tolerance_pct    numeric(5,2) not null default 5.0,
  price_min_cents  integer generated always as
                     (round(target_cents * (100 - tolerance_pct) / 100)::integer) stored,
  price_max_cents  integer generated always as
                     (round(target_cents * (100 + tolerance_pct) / 100)::integer) stored,
  channels         text[] not null default '{}',   -- vazio = todos
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  last_alert_at    timestamptz
)

-- Alertas (dedup + entrega confiável)
alerts (
  id           bigserial primary key,
  hunt_id      uuid not null references hunts(id) on delete cascade,
  post_row_id  bigint not null references posts(id) on delete cascade,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,          -- null = ainda não entregue
  attempts     integer not null default 0,
  unique (hunt_id, post_row_id)      -- dedup estrutural, não lógica de aplicação
)

-- Sessões de conversa do bot
bot_sessions (
  chat_id     bigint primary key,
  flow        text not null,          -- 'new_hunt'
  step        text not null,          -- 'ask_product' | 'ask_price' | 'confirm'
  data        jsonb not null default '{}',
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null
)
```

Duas escolhas que carregam peso:

- **`unique (hunt_id, post_row_id)` em `alerts`** — o banco garante que você nunca recebe o mesmo alerta duas vezes. Não depende de a aplicação lembrar de nada.
- **`sent_at` separado de `created_at`** — a linha é inserida **antes** de mandar no Telegram. Se a entrega falhar (ou a função morrer no meio), o alerta fica pendente e o próximo tick reenvia. Marcar como enviado antes de enviar perderia alertas em silêncio, que é o pior modo de falha possível aqui.

**Dinheiro sempre em centavos int.** Nunca float.

## 5. Arquitetura

```
app/api/cron/tick/route.ts        # coleta + casa caças + entrega alertas
app/api/cron/backfill/route.ts    # caminha o histórico pra trás
app/api/telegram/[bot]/route.ts   # webhook (um handler, dois bots)

lib/collector/fetch.ts            # GET t.me/s/<slug>[?before=<id>]
lib/collector/parse.ts            # HTML → Post[]          ← puro
lib/parse/price.ts                # HTML → centavos[]      ← puro
lib/parse/store.ts                # texto → loja + link    ← puro
lib/match/terms.ts                # query → variantes      ← puro
lib/match/hunt.ts                 # (post, hunt) → bool    ← puro
lib/search/query.ts               # busca histórica + estatística
lib/bot/router.ts                 # update → comando/sessão
lib/bot/flows/new-hunt.ts         # máquina de estados da conversa
lib/telegram.ts                   # sendMessage, escapeHtml
lib/db.ts                         # cliente Supabase service_role
```

Tudo marcado como **puro** é função sem I/O, testável sem rede e sem banco. É onde mora a lógica que erra, e é onde ficam os testes.

### Fluxo do tick (a cada 5 min)

```
cron-job.org → x-cron-secret → /api/cron/tick
  1. para cada canal ativo (Promise.allSettled):
       GET t.me/s/<slug> → parse → upsert posts com post_id > last_post_id
       avança last_post_id
  2. para cada caça ativa:
       candidatos = posts novos desde o tick anterior
                    WHERE search_vector @@ query
                      AND price_cents BETWEEN price_min AND price_max
       filtra em app com terms_any/all/none
       INSERT INTO alerts ... ON CONFLICT DO NOTHING
  3. entrega: para cada alert com sent_at IS NULL (inclui pendências antigas):
       sendMessage no bot correspondente ao bot_key da caça
       sucesso → sent_at = now()
       falha   → attempts += 1
```

Busca em duas fases é deliberada: o índice GIN + índice de preço reduzem centenas de posts a poucos candidatos dentro do Postgres; a checagem exata de termos roda em app sobre esse punhado. Rodar regex sobre a tabela inteira não escala depois de alguns meses de arquivo.

### Fluxo do backfill

Roda a cada 10 min, **uma página por canal por invocação** — lento de propósito, pra não martelar o `t.me`. Para cada canal com `backfill_complete = false`: `GET t.me/s/<slug>?before=<backfill_cursor>`, insere, recua o cursor. Encerra quando a página vem vazia ou os posts passam de `BACKFILL_MONTHS` (padrão 6). Depois disso a rota é no-op.

A profundidade real do arquivo varia por canal e **precisa ser medida na implementação** — a paginação `?before=` funciona (confirmado), mas quanto cada canal retém é desconhecido até testar.

## 6. As quatro etapas

### Etapa A — Ingestor + arquivo

Migrations, `lib/collector/*`, `lib/parse/*`, `/api/cron/tick` (só a parte de coleta), `/api/cron/backfill`. Seed dos canais.

**Pronto quando:** o arquivo tem os posts dos canais dos últimos meses, com preço extraído corretamente nos casos da suíte de fixtures, e o tick incremental não duplica nem pula post.

### Etapa B — Busca histórica

`lib/search/query.ts`. Dada uma expressão livre e uma janela (padrão 6 meses):

- filtra por FTS português + `price_cents not null`;
- calcula **mínimo, mediana e contagem** do conjunto casado;
- retorna as 5 melhores por preço, com data, loja e link.

A mediana é o que dá sentido ao número: saber que o mínimo histórico foi R$2.799 e a mediana R$3.150 responde a pergunta real, que é "R$3.000 é um bom preço?".

**Pronto quando:** `calça de academia` e `garrafinha` retornam resultados plausíveis, sem acessório de outro produto no topo.

### Etapa C — Bot conversacional

Webhook em `/api/telegram/[bot]`, validando `X-Telegram-Bot-Api-Secret-Token` e a allowlist de `chat_id`. Sessões em `bot_sessions`, expiram em 10 min.

- **Texto livre sem sessão ativa** → busca histórica (Etapa B) e devolve o resumo.
- **`/cacar`** → inicia a conversa guiada:
  1. "Qual produto você quer caçar?" → `s25 plus`
  2. Bot **consulta o histórico antes de perguntar o preço** e responde com o contexto: *"Nos últimos 6 meses achei 23 ofertas. Mínimo R$2.799, mediana R$3.150. Quanto você quer pagar?"*
  3. → `3000` → "Faixa: R$2.850 a R$3.150 (±5%). Confirma?"
  4. Confirmado → cria a caça.
- **`/cacas`** → lista as ativas com botões de pausar/excluir.
- **`/ajuda`**.

O passo 2 é o que amarra os subsistemas: a busca deixa de ser feature separada e vira o que impede você de configurar um alvo irreal que nunca dispara.

**Pronto quando:** dá pra criar, listar, pausar e excluir caça inteiramente pelo chat, e sessão abandonada expira sem travar o bot.

### Etapa D — Alertas

`lib/match/hunt.ts` + as partes 2 e 3 do tick. Mensagem de alerta traz produto, preço, quanto está abaixo do alvo, loja, data e link do post original.

**Pronto quando:** uma caça de teste com alvo propositalmente alto dispara no primeiro tick, não repete no segundo, e uma falha simulada de entrega é reenviada no tick seguinte.

## 7. Erros

| Situação | Comportamento |
|---|---|
| Um canal fora do ar / timeout | `Promise.allSettled`, loga, segue os outros. Um canal não derruba o tick. |
| **Todos** os canais com zero posts | Erro barulhento + mensagem no Telegram. É o canário de "o `t.me` mudou o HTML" — falhar em silêncio aqui significa meses achando que não teve oferta. |
| Falha ao enviar alerta | `sent_at` fica null, `attempts++`, reenvia no próximo tick. Acima de 5 tentativas, para e loga. |
| Post sem preço extraível | Guarda com `price_cents = null`. Entra no arquivo e na busca textual, nunca em alerta. |
| Webhook com secret errado ou chat fora da allowlist | 401, sem processar. |
| Duas invocações de cron sobrepostas | Cursores avançam por linha; `unique` em `posts` e `alerts` absorve a corrida. |

## 8. Testes

Vitest. O alvo são os módulos puros:

- **`parse/price`** — fixtures dos casos reais: riscado + parcela na mesma mensagem, preço sem centavos, múltiplos produtos num post, preço só na imagem (espera `null`), `R$ 1.199` vs `R$ 1199`.
- **`collector/parse`** — páginas HTML do `t.me/s/` salvas em disco, incluindo uma página vazia e uma paginada.
- **`match/terms`** — `s25 plus` casa com `S25+`, `Galaxy S25 Plus`, `S25 PLUS`; **não** casa com `S25 Ultra` nem `S24 Plus`.
- **`match/hunt`** — a capa de R$29, o seminovo, o post na faixa, o post R$1 acima do teto.
- **`search/query`** — mediana e mínimo sobre conjunto conhecido.

Fixtures vêm de posts reais capturados dos canais, não inventados.

## 9. Configuração

**Env (Vercel):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN_OFERTAS`, `TELEGRAM_BOT_TOKEN_CHINA`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`, `ALLOWED_CHAT_IDS`.

**Canais no seed:**

| slug | kind |
|---|---|
| `ctofertascelulares` | tech |
| `TudoPromo` | tech |
| `jgtechofertas` | tech |
| `gtOFERTAS` | tech |
| `Chinacuponsbr` | china |
| `CuponsAliExpressChinaCuponsBR` | china |
| `AliexpresspromocoesecuponsBR` | china |

**Jobs no cron-job.org** (header `x-cron-secret`):

| Rota | Frequência |
|---|---|
| `/api/cron/tick` | 5 min |
| `/api/cron/backfill` | 10 min (no-op depois de completo) |

**Caça inicial (seed):** Galaxy S25+ 256/512GB novo, alvo R$3.000, tolerância 5% → faixa R$2.850–3.150, `terms_none` com `capa, pelicula, película, carregador, cabo, suporte, seminovo, semi-novo, recondicionado, vitrine, usado`.

> Nota: o alvo de R$3.000 combinado antes correspondia a uma faixa manual de R$2.500–3.300. Com a regra ±5% a faixa fica **R$2.850–3.150**, mais estreita. Se a intenção era a faixa larga, a caça deve nascer com `tolerance_pct = 10` (R$2.700–3.300) — decidir antes de rodar o seed.

## 10. Fora de escopo

- Consultar preço direto nas lojas (anti-bot, manutenção alta). O arquivo dos canais é a única fonte.
- Camada LLM no matcher. `lib/match/` é isolado justamente pra permitir isso depois sem reescrever nada.
- UI web.
- Multi-usuário.
