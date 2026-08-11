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
  crash — mitigado, não eliminado.** O lease é de **2 minutos** e o tick roda
  a cada **5**, então uma linha órfã de um tick que morreu no meio está sempre
  livre para reivindicação no tick seguinte — e se o `sendMessage` daquele tick
  chegou a completar antes da morte, o usuário recebe o mesmo alerta duas
  vezes. Crash de função na Vercel é raro; estourar o `maxDuration` de 60s não
  era: com a serialização por chat da correção do 429 (mono-usuário → todos os
  alertas no mesmo chat → entrega vira sequencial), o pior caso teórico de
  `LOTE_ENVIO=5` × 15s de timeout por envio já não cabia nos 60s, mesmo sem
  contar o `ingestAll` antes.

  A correção: `ORCAMENTO_ENTREGA_MS` (35s, `lib/cron/alerts.ts`) — uma guarda
  de prazo que para de **iniciar** novos envios depois de 35s de processamento
  desde o começo de `processarAlertas`, deixando o resto pendente pro próximo
  tick. Checada *antes* do claim, então a linha adiada não ganha `attempts`
  nem `claimed_at` — volta limpa pra fila. Um envio já iniciado não é
  interrompido no meio; termina ou estoura o próprio timeout de 15s.
  Alternativas descartadas: reduzir o timeout de envio vira constante mágica
  que se desatualiza quando `LOTE_ENVIO` ou a contagem de canais mudar, e
  transforma resposta lenta-porém-bem-sucedida em falha; aumentar o lease não
  toca na duração do tick, só adia quando a duplicata acontece.

  **O que isso não resolve:** a guarda reduz muito a chance de o tick estourar
  o `maxDuration` — mas não é uma garantia matemática do pior caso absoluto
  (ingest no teto dos ~15s *e* o envio em voo no momento do corte também no
  teto dos 15s ainda somam mais que os 60s). E ela não elimina a duplicata por
  morte de processo em si: se a função for morta por qualquer outro motivo
  (não só timeout) depois do `sendMessage` completar e antes de gravar
  `sent_at`, a linha ainda libera pelo lease e repete no tick seguinte. O
  trade-off original continua valendo — perder alerta é pior que repetir.

- **Terceira variante de cupom não coberta: "+ R$X na finalização".** Depois do
  reprocessamento de 2026-08-10 (27.343 posts, 2.225 preços corrigidos), sobrou
  este padrão, verificado em dado real:

  ```
  "🎟 BRASILPRIME + R$200 na finalização"  → R$200 vira o preço de um S25 Ultra
  ```

  Os marcadores atuais (`cupom|desconto|resgate|voucher|codigo`) não pegam
  "na finalização", e o `🎟` também não está na lista. Efeito medido: a mediana
  de `galaxy s25` ficou sã (R$3.967, plausível), mas o **mínimo** ainda mostra
  resíduo (R$200). Como é a mediana que orienta a decisão de compra, não bloqueia.

  Antes de acrescentar mais marcadores, considere que esta é a terceira variante
  descoberta — lista de palavras é manutenção infinita. `docs/PLANO.md` propõe
  ranquear por distância da mediana, que afunda esses valores estruturalmente
  em vez de enumerá-los.

- **Posts que são lista de cupom ficam com o piso de compra como "preço".**
  Ex.: `"R$300 OFF a partir de R$1.499"` grava R$1.499. Nem o cupom nem o piso
  são preço de produto — o certo seria `null`. Não é regressão (antes gravava o
  valor do cupom, pior), e esses posts raramente casam com busca de produto.

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
