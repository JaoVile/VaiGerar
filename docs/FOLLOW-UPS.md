# Pendências conhecidas

Levantadas nas revisões de código (Etapa A, e depois Etapa C) e
deliberadamente adiadas. Nenhuma
bloqueia a operação; estão aqui para não serem redescobertas do zero.

## Precisa de ação humana

Nada pendente. Deploy, cron e migrations `0001`–`0006` aplicados; o sistema
coleta sozinho desde 10/08. (Esta seção listava o deploy na Vercel e os dois
jobs do cron-job.org — ambos feitos.)

## Vale corrigir quando tocar no código

- ~~**Sem teste de regressão para o teto de preço e para `datetime` inválido.**~~
  **RESOLVIDO em 12/08.** `tests/collector/parse.test.ts` monta páginas com
  post estragado de propósito e cobra as duas guardas. Verificado por mutação:
  tirar a checagem de data reproduz o `RangeError: Invalid time value` que o
  comentário do código previa, e afrouxar `MAX_PRICE_CENTS`/`MIN_PRICE_CENTS`
  deixa passar "R$ 9.999.999,00" e "R$ 0,50".

- **`"cursor travado"` marca o canal como completo com confiança alta demais.**
  A razão é heurística: não distingue canal genuinamente raso de um bug de
  paginação do `t.me` que devolvesse sempre a mesma página com posts válidos.
  O canário de `countPostAnchors` não pega esse caso, porque os posts continuam
  sendo extraídos normalmente.

- **`savePosts` devolve `rows.length`, não linhas realmente inseridas.**
  Com `ignoreDuplicates: true`, o campo `saved` do relatório superestima. É um
  número que o operador usa para decidir se algo está errado.

- **Post editado no Telegram nunca atualiza no arquivo.** `ignoreDuplicates: true`
  ignora a linha existente em vez de atualizá-la.

  **Medido em 12/08, sem evidência de ser problema ativo:** comparando 99 posts
  de 5 canais com o que está no ar, **zero** aparece marcado como `edited` no
  `t.me`. A premissa de que "canais de oferta editam o tempo todo" não se
  sustentou nesta amostra.

  A comparação acusou 34% de divergência, mas é **artefato**: `htmlToText`
  descarta conteúdo riscado de propósito (o preço velho), então o arquivo
  guarda `DE 🔥 POR R$ 1.747,90` onde o post ao vivo diz
  `DE R$ 2.989,00 🔥 POR R$ 1.747,90`. Efeito colateral conhecido: esse texto
  também alimenta o índice de busca.

- ~~**`productUrl` é o primeiro link do post**~~ — **MEDIDO em 12/08 e
  descartado.** Em 8.000 posts com `product_url`, só **5 (0,1%)** apontam para
  grupo ou canal; o resto são encurtadores de loja (`meli.la`, `amzn.to`,
  `link.amazon`, `s.shopee.com.br`, `pechin.co`). O link já é mostrado ao
  usuário em três lugares desde 12/08 e o risco previsto não se materializou.

- **O tick busca todos os canais em paralelo** (`Promise.all`), hoje 25. Sem
  tratamento de 429, sem backoff, sem jitter.

  **Reavaliado em 12/08, prioridade baixa:** `ingestChannel` captura a própria
  exceção e devolve relatório de erro, então `Promise.all` nunca rejeita e um
  canal quebrado não derruba a rodada — o risco descrito originalmente não
  existe. Medido com 25 canais: 3 ticks seguidos, zero erro, 2,9 s a quente.
  Fica como fragilidade a vigiar se o catálogo crescer muito mais, não como
  defeito.

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

- ~~**A guarda `ORCAMENTO_ENTREGA_MS` é inerte com relógio real.**~~
  **CORRIGIDA em 12/08.** A checagem passou a acontecer dentro da fila de
  entrega, antes de cada `sendMessage` — `filaPorChat` serializa por chat,
  então é o único ponto do caminho onde o relógio já andou. Linha adiada
  volta limpa, com o mesmo desfazer do 429. O teste antigo contava chamadas
  em vez de tempo e passava com a guarda inerte; foi trocado por três, um
  deles com `cronometro()` real e envio lento. Detalhe no item 2 do
  `docs/PLANO-MELHORIAS.md`.

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

