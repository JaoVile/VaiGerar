# Pendências conhecidas

Levantadas nas revisões de código (Etapa A, e depois Etapa C) e
deliberadamente adiadas. Nenhuma
bloqueia a operação; estão aqui para não serem redescobertas do zero.

## Precisa de ação humana

- **Deploy na Vercel.** Importar `JaoVile/VaiGerar`. Variáveis: `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `TELEGRAM_BOT_TOKEN_OFERTAS`.
- **Agendar no cron-job.org.** Dois jobs POST com header `x-cron-secret`:
  `/api/cron/tick` a cada 5 min, `/api/cron/backfill` a cada 10 min.
  **Enquanto isso não existir, nada coleta sozinho.**

## Vale corrigir quando tocar no código

- **Sem teste de regressão para o teto de preço e para `datetime` inválido.**
  As duas guardas existem (`MAX_PRICE_CENTS` em `lib/parse/price.ts`; validação
  de data em `lib/collector/parse.ts`) mas nenhuma fixture as exercita — a
  garantia hoje vem só da leitura do código. Um post com preço absurdo ou data
  malformada trava a gravação do lote inteiro, e no backfill isso é permanente,
  então a regressão seria cara.

- **`"cursor travado"` marca o canal como completo com confiança alta demais.**
  A razão é heurística: não distingue canal genuinamente raso de um bug de
  paginação do `t.me` que devolvesse sempre a mesma página com posts válidos.
  O canário de `countPostAnchors` não pega esse caso, porque os posts continuam
  sendo extraídos normalmente.

- **`savePosts` devolve `rows.length`, não linhas realmente inseridas.**
  Com `ignoreDuplicates: true`, o campo `saved` do relatório superestima. É um
  número que o operador usa para decidir se algo está errado.

- **Post editado no Telegram nunca atualiza no arquivo.** `ignoreDuplicates: true`
  ignora a linha existente em vez de atualizá-la. Canais de oferta editam preço
  e marcam "encerrado" o tempo todo. Isso é consequência não examinada do desenho,
  não escolha deliberada — vira relevante na Etapa B, quando o preço arquivado
  virar base de alerta.

- **`productUrl` é o primeiro link do post**, que pode ser o do rodapé do canal
  ("entre no nosso grupo") em vez do link do produto. Vira dívida visível na
  Etapa B, quando esse link for mostrado ao usuário.

- **O tick busca os 7 canais em paralelo** (`Promise.all`), e cresce linearmente
  a cada canal novo no seed. Sem tratamento de 429, sem backoff, sem jitter. O
  backfill é serial de propósito; os dois cron se contradizem nesse ponto. Um
  limite de concorrência de 2–3 resolveria sem custo real de latência.

- **User-Agent se passa por Chrome** (`lib/collector/fetch.ts`). Um identificador
  próprio com forma de contato seria mais honesto e não muda nada tecnicamente.
  (`https://t.me/robots.txt` devolve 404 — não há diretiva sendo desobedecida.)

## Etapa C — bot e alertas

- **Entrega duplicada de alerta: o gatilho realista é _timeout do tick_, não
  crash.** O comentário original do lease em `lib/cron/alerts.ts` falava em
  "crash", e isso subestima o risco: o lease é de **2 minutos** e o tick roda a
  cada **5**, então uma linha órfã de um tick que morreu no meio está sempre
  livre para reivindicação no tick seguinte — e se o `sendMessage` daquele tick
  chegou a completar antes da morte, o usuário recebe o mesmo alerta duas
  vezes. Crash de função na Vercel é raro; estourar o `maxDuration` de 60s não
  é: o tick faz `ingestAll` dos canais **e** até 5 entregas cujo timeout
  individual é de 15s, e desde a correção do 429 as entregas para o mesmo chat
  são serializadas (o pior caso teórico, 5 × 15s, já não cabe nos 60s). O
  desenho está certo na prioridade — perder alerta é pior que repetir alerta —
  mas o número está frouxo. Saídas, quando incomodar: lease maior que o
  intervalo do tick (ex.: 6 min), ou gravar `sent_at` **antes** do envio
  (troca duplicata por perda), ou uma guarda de prazo que pare de iniciar
  envios novos perto do fim do orçamento da função.

## Avaliado e descartado

- `assertCronAuth` usa `!==` em vez de comparação constant-time. Timing attack
  remoto sobre HTTPS contra segredo aleatório de tamanho pleno não é ameaça
  prática. `crypto.timingSafeEqual` é barato se quiser fechar mesmo assim.
- A rota devolve `error.message` cru no JSON. A rota é autenticada por segredo e
  a mensagem é erro de Supabase/HTTP, não credencial.
- `oldestAllowedFrom` usa `setMonth`, que desliza alguns dias em fim de mês
  (31/08 dá 03/03 em vez de 01/03). A janela de 6 meses é heurística; ±3 dias
  não muda nada.
- `STRIKE_RE` não trata `<s>` aninhado na mesma tag. Verificado: o resultado é
  idêntico ao caso simples, não vaza preço riscado.
