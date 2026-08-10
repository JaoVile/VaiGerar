# Pendências conhecidas — Etapa A

Levantadas nas revisões de código da Etapa A e deliberadamente adiadas. Nenhuma
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
