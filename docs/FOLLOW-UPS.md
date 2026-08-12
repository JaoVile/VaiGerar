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

## Review final da branch `mediana-regua` (2026-08-12)

Achados da última revisão antes do merge. Os quatro que valiam correção
imediata (rótulo do `/cacas`, piso ignorado na faixa, handler do botão "mais
ofertas" sem teste, "0% acima do teto") foram corrigidos nesta mesma rodada.
Estes cinco ficaram, com o porquê.

- **A guarda `ORCAMENTO_ENTREGA_MS` é inerte com relógio real.**
  `processarAlertas` monta os até `LOTE_ENVIO` envios com
  `Promise.allSettled((pendentes).map(...))`: o `.map` invoca as 5 chamadas de
  `processarUmAlerta` **sincronamente**, e `decorridoMs()` é a primeira
  instrução da função, antes de qualquer `await`. As 5 leem, portanto, o mesmo
  instante. Medido num tick real: `[2, 2, 2, 2, 2]` ms para uma execução de
  **344 ms** de duração. O comportamento pretendido — "as primeiras vão, o
  resto fica pro próximo tick" — nunca acontece; ou nenhuma é adiada (caso
  normal), ou todas seriam.

  O teste passa porque o `decorridoMs` injetado conta **chamadas**, não tempo:
  ele documenta um mecanismo que o relógio real não produz. **Isso importa mais
  que os outros itens desta lista:** essa guarda foi a correção de uma
  regressão de timeout registrada logo acima neste mesmo arquivo ("Entrega
  duplicada de alerta"), e essa regressão continua sem defesa efetiva.

  Não foi corrigido agora porque o conserto não é local: exige medir o tempo
  *entre* os inícios (fila com concorrência limitada, ou checar o orçamento
  logo antes do `sendMessage` em vez de antes do claim) e reescrever o teste
  para tempo real ou relógio fake — mudança de desenho no caminho crítico de
  entrega, arriscada de emendar numa rodada de correção de review.

- **A memoização de `statsDaCaca` não tem teste e não rende na configuração
  atual.** Remover o cache inteiro deixa os testes passando (225/225 no momento
  da medição). O fixture esconde o caso real: o `.single()` do fake ignora o
  filtro `eq`, então os 5 alertas do lote resolvem para a *mesma* caça e o
  cache acerta por acidente. Em produção há 6 caças distintas; um lote de 5
  alertas de caças diferentes faz 5 `buscar` distintos — benefício zero, e o
  cache só paga quando a mesma caça tem 2+ alertas no mesmo lote.

  Não é bug (o cache está correto, inclusive ao guardar a promise em vez do
  valor); é código sem cobertura e sem retorno hoje. Fica porque passa a
  render sozinho se o lote crescer ou uma caça casar vários posts no mesmo
  tick. Ao mexer: corrigir o fake para respeitar o `eq` antes de escrever o
  teste, senão ele nasce testando o acidente.

- **O post que dispara o alerta nunca passa pelo piso de 25%.** `aplicarPiso`
  (`lib/search/stats.ts`, `PISO_FRACAO = 0.25`) filtra o **conjunto da
  estatística** dentro de `buscar`; o post que vira alerta vem de `casa()`
  (`lib/hunts/match.ts`), que só olha a faixa da caça e os termos. Efeito: um
  post muito abaixo da mediana pode alertar dizendo "83% abaixo da mediana"
  enquanto o `/agora` do mesmo termo esconde esse mesmo post por considerá-lo
  acessório. Duas leituras do mesmo dado, com critérios diferentes.

  Não corrigido agora porque o piso da caça (`priceMinCents`) já cobre o caso
  comum e aplicar o piso relativo também no alerta muda *quais alertas saem* —
  é mudança de comportamento do motor, não de texto, e merece decisão
  deliberada em vez de carona numa rodada de review.

- **`buscar` puxa a coluna `text` para chamadores que só querem preço.** O
  `select` é `text,price_cents,store,posted_at,url` sobre até `TETO_LINHAS =
  2000` linhas. `statsDaCaca` usa só a mediana; o `/cacas` usa só o primeiro
  preço e a mediana. Nenhum dos dois lê `text`, mas os dois carregam o corpo do
  post — ~0,6–1,6 MB por consulta, e o `/cacas` faz uma por caça (6 hoje). Um
  `buscar` que aceitasse selecionar só `price_cents` nesses casos cortaria ~90%
  do payload.

  Não corrigido agora porque exige uma variante do `buscar` (ou um parâmetro de
  projeção) e mexer no tipo de retorno, o que toca todos os chamadores — e o
  tempo de resposta atual não é problema para o usuário.

- **Toque duplo no botão "mais ofertas" gera erro visível.** O segundo clique
  no mesmo botão renderiza texto idêntico, o Telegram devolve 400 `message is
  not modified`, `editMessageText` lança, e o usuário vê "Deu erro aqui do meu
  lado. Tenta de novo em instantes." — para uma ação que na verdade deu certo.
  A rota continua respondendo 200 (o `try/catch` em volta de `tratar()` na
  rota do webhook cobre tudo), então a invariante do webhook está intacta.

  Não corrigido agora porque a correção certa é tratar `message is not
  modified` como sucesso dentro de `lib/telegram.ts` — mexer no cliente HTTP
  compartilhado por todos os envios, num caso que é cosmético e disparado só
  por clique repetido.

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

## Título de post: os últimos 4,3%

`tituloDoPost` escolhe rodapé do canal em vez do nome do produto em **4,3%**
dos posts (medido em 12/08 sobre 8.000 posts, avaliando numa metade a lista
derivada da outra). Veio de 16,2%.

O que fecharia a diferença, medido: uma tabela de linhas que se repetem 5+
vezes no arquivo, alimentada por cron, derruba pra **2,5%**. Nome de produto é
praticamente único; rodapé se repete centenas de vezes — a frequência é o
detector, e `REGEX_BOILERPLATE` é só o resultado dela congelado em código.

**Ficou de fora por 1,8 ponto percentual** contra uma tabela nova, um job novo
e uma dependência de escrita no caminho da busca. Reavaliar se a taxa subir —
ela sobe sozinha quando entra canal novo com rodapé que a regex não conhece.

