# Plano — o que fazer depois que o cofrinho estourar

Escrito em 2026-08-10, quando a Etapa A entrou em produção e a decisão foi
deixar o arquivo engordar antes de seguir. Este documento existe para que,
daqui a semanas ou meses, ninguém precise reconstruir o raciocínio.

## Onde paramos

O coletor está no ar e roda sozinho: `tick` a cada 5 min, `backfill` a cada
10 min, 13 canais em 4 categorias. Em 10/08 o arquivo tinha **15.747 posts**.
Nada precisa de intervenção humana para continuar crescendo.

## Como saber que engordou o bastante

Não é questão de tempo, é de densidade por categoria. Rode a busca e olhe a
contagem — o gatilho é **50+ ofertas para um termo específico**, não para um
genérico.

| termo de teste | em 10/08 | pronto quando |
|---|---:|---:|
| `calça academia` | 3 | 50+ |
| `air fryer` | 41 | 100+ |
| `mesa cabeceira` | — | 30+ |
| `galaxy s25` | 366 | já está |

Consulta rápida para medir (ajuste o termo):

```bash
curl -s "$SUPABASE_URL/rest/v1/posts?select=id&search_vector=plfts(portuguese).calça%20academia&price_cents=not.is.null" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Prefer: count=exact" -H "Range: 0-0" -D- -o/dev/null | grep -i content-range
```

Estimativa grosseira: os 13 canais somam ~1.400 posts/dia. Um mês adiciona
~42 mil; três meses, ~126 mil. As categorias `moda` e `casa` entraram em 10/08
do zero, então são elas que ditam o ritmo.

## O que fazer primeiro — antes de qualquer feature nova

Dois defeitos apareceram ao testar a busca contra dado real. Nenhum dos dois
foi previsto no papel; ambos só existem porque o arquivo existe.

### 1. Valor de cupom é lido como preço do produto

*(Corrigido em 10/08: o diagnóstico inicial dizia "parcela em outro formato".
Errado — ao ler os posts reais, a causa é outra.)*

Os posts anunciam cupons em reais, e o parser conta esses valores como candidatos
a preço. Como `priceCents` é o **menor** valor encontrado, o cupom ganha:

```
"aplicar o cupom R$ 30 OFF na página"          → 3000    vira o preço
"Aplique R$ 30 OFF no anúncio"                 → 3000    vira o preço
"Resgate o cupom de R$ 80 ... cupom de R$ 500" → 8000    vira o preço
"VALOR DA OFERTA R$ 3.967 - ANTES R$ 4.299"    → 396700  era esse
```

Isso **não gera alerta falso** — a faixa `alvo ± tolerância` tem piso e protege.
Mas **contamina a mediana**, que é justamente o número usado para decidir se um
preço é bom. Um defeito que corrompe a régua é pior que um que corrompe uma
leitura isolada.

Correção: em `lib/parse/price.ts`, descartar valores cujo contexto anterior
contenha marcador de cupom (`cupom`, `OFF`, `desconto`, `resgate`). Verificado
contra os três posts acima: com o descarte, o menor valor restante é o preço
certo em todos. O preço "ANTES" continua sendo absorvido por ser o maior.

### 2. A busca casa o termo, não o produto

`air fryer` traz *forma de silicone para air fryer* a R$10,30. `mesa` traz
*taças para mesa posta* a R$19,90. É o problema do acessório, que o alerta já
resolve com piso de preço, migrando para o lado da busca.

Três abordagens, da mais barata para a mais cara:

- **Ranquear por distância da mediana** em vez de preço bruto. O acessório
  baratíssimo afunda sozinho, sem lista de palavras proibidas para manter.
- **Faixa automática por termo**, derivada do próprio arquivo: calcula a
  mediana do conjunto casado e descarta o que estiver muito abaixo.
- **Camada LLM** classificando "isto é o produto ou um acessório dele". Fica
  para se as duas primeiras não bastarem — `lib/match/` foi isolado justamente
  para permitir isso sem reescrever nada.

Comece pela primeira. É a que resolve mais por menos.

## Depois disso, as etapas que faltam

Cada uma ganha spec → plano → implementação própria, na ordem. O spec das
quatro está em `docs/superpowers/specs/2026-08-05-cacador-ofertas-design.md`.

**Etapa B — busca histórica.** `lib/search/query.ts`: dado um termo e uma
janela, devolve mínimo, mediana, contagem e as melhores ofertas. É onde os dois
defeitos acima são resolvidos. Depende só do arquivo, que já existe.

**Etapa C — bot conversacional.** Webhook em `/api/telegram/[bot]`, allowlist
de `chat_id`, sessões em `bot_sessions`. `/agora <texto>` para busca sob
demanda, `/cacar` para a conversa guiada que cria uma caça. O passo que amarra
tudo: antes de perguntar o preço-alvo, o bot mostra mínimo e mediana reais do
arquivo, para você não configurar um alvo que nunca dispara.

**Etapa D — alertas e resumo diário.** O matcher com faixa `alvo ± tolerância`,
entrega com `sent_at` separado de `created_at` (reenvia se falhar), e o resumo
diário agrupando por produto e loja — "apareceu em quantos lugares hoje e onde
saiu mais barato".

## Melhorias planejadas

Seis itens levantados em 2026-08-11, com o sistema já em produção, estão em
**`docs/PLANO-MELHORIAS.md`** — ranqueamento por mediana, alerta com contexto,
paginação do `/agora`, tendência de preço, segundo bot e resumo diário. Cada um
com o problema medido em dado real, a abordagem, e as decisões a tomar antes de
escrever código.

## Vigiar enquanto engorda

- **Capacidade.** ~1,4 KB por post; o free tier do Supabase (500 MB) comporta
  ~367 mil posts. No ritmo atual isso dá uns 7 meses. Quando chegar perto:
  ou US$25/mês no Pro, ou podar canal, ou apagar post antigo sem preço.
- **Canário.** Se o `tick` começar a devolver 500 com `CANÁRIO` no log da
  Vercel, o `t.me` mudou o HTML. Procedimento em `docs/OPERATIONS.md`.
- **Backfill.** `gtOFERTAS` e `Chinacuponsbr` ainda estão recuando o histórico.
  `backfill_complete = false` por dias é normal, não é defeito.
- **Cobertura de academia.** Não existe canal de fitness/suplemento vivo no
  cadastro — os que os sites listam estão mortos. A cobertura vem do
  `xetdaspromocoes` misturada com o resto. Se ficar fraca, tentar canais de
  loja específica (Centauro, Netshoes) em vez de agregador.

## Dívidas conhecidas

Estão em `docs/FOLLOW-UPS.md`, com o que foi avaliado e **descartado** junto do
motivo — para ninguém "consertar" daqui a três meses algo que já foi analisado.
