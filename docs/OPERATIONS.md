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

Só investigue como problema se, depois de rodar por muitos dias, o
`backfill_cursor` **parar de mudar** com o canal ainda `backfill_complete =
false` — isso sim é sintoma real, coberto por `decideBackfill` (razão
`"cursor travado"` em `lib/cron/backfill.ts`).

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
