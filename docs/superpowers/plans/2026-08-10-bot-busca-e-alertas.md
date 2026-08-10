# Bot, Busca e Alertas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o arquivo de 15 mil posts virar produto — busca sob demanda pelo Telegram, criação de caça por conversa guiada, e alerta disparando quando aparece oferta na faixa.

**Architecture:** Três camadas sobre o coletor que já roda. `lib/search/` consulta o arquivo com full-text do Postgres e devolve estatística de preço. `lib/bot/` recebe o webhook do Telegram, roteia comandos e mantém a sessão da conversa guiada em `bot_sessions`. `lib/hunts/` casa post contra caça, e a entrega de alerta entra como uma etapa a mais do `tick` que já existe — sem cron novo, sem corrida entre "post gravado" e "caça lê o post".

**Tech Stack:** Next.js 15 (App Router, TypeScript), Supabase Postgres, Vitest, Biome, pnpm. Telegram Bot API via `fetch`, sem SDK.

## Global Constraints

- **Dinheiro sempre em centavos (`integer`).** Nunca float, nunca reais.
- **Nada de `any`.** Biome trata como warning; não introduza nenhum.
- **Módulos puros não fazem I/O:** `lib/parse/*`, `lib/collector/parse.ts`, `lib/search/stats.ts`, `lib/bot/format.ts`, `lib/bot/flows/*`, `lib/hunts/*`. Sem `fetch`, sem cliente de banco, sem `new Date()` implícito — receba `now` por parâmetro quando precisar.
- **Cliente Supabase é sempre `service_role`, só no servidor.** Mono-usuário, sem RLS.
- **Nenhum segredo em arquivo versionado.** Só nomes de variáveis.
- **Migrations rodam manualmente** no SQL Editor do Supabase, em ordem numérica. A próxima é `0004`.
- **Não rode `pnpm run check`** no meio do trabalho — reformata o repositório inteiro. Formate só os arquivos que criar.
- Node 20+, **pnpm**. Fuso de negócio `America/Sao_Paulo`; `timestamptz` guarda UTC.
- Spec: `docs/superpowers/specs/2026-08-05-cacador-ofertas-design.md`

## Interfaces que já existem (não reimplemente)

```ts
// lib/env.ts
readEnv(source?): { supabaseUrl, supabaseServiceKey, cronSecret }
// lib/db/client.ts
createDb(): SupabaseClient
// lib/parse/price.ts
htmlToText(html): string;  toCents(raw): number | null
parsePrices(html): { pricesCents: number[]; priceCents: number | null }
// lib/cron/ingest.ts
ingestAll(db): Promise<IngestReport[]>;  summarize(reports): {...}
// lib/cron/auth.ts
assertCronAuth(req, secret): void
```

Tabelas `hunts`, `alerts`, `bot_sessions`, `user_settings` já existem (migration `0001`) e estão vazias. Colunas em `docs/superpowers/specs/2026-08-05-cacador-ofertas-design.md` §4.

---

### Task 1: Variáveis de ambiente do Telegram

**Files:**
- Modify: `lib/env.ts`
- Modify: `.env.local.example`
- Test: `tests/env.test.ts`

**Interfaces:**
- Produces: `Env` ganha `telegramBotToken: string`, `telegramWebhookSecret: string`, `allowedChatIds: number[]`

- [ ] **Step 1: Escrever os testes que falham**

Acrescente a `tests/env.test.ts` (não altere os testes existentes):

```ts
const COMPLETO = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "key",
  CRON_SECRET: "secret",
  TELEGRAM_BOT_TOKEN_OFERTAS: "123:abc",
  TELEGRAM_WEBHOOK_SECRET: "wh",
  ALLOWED_CHAT_IDS: "111,222",
};

describe("readEnv — telegram", () => {
  it("lê o token e o segredo do webhook", () => {
    const env = readEnv(COMPLETO);
    expect(env.telegramBotToken).toBe("123:abc");
    expect(env.telegramWebhookSecret).toBe("wh");
  });

  it("converte ALLOWED_CHAT_IDS em números", () => {
    expect(readEnv(COMPLETO).allowedChatIds).toEqual([111, 222]);
  });

  it("tolera espaços e entradas vazias na lista", () => {
    expect(readEnv({ ...COMPLETO, ALLOWED_CHAT_IDS: " 111 , ,222 " }).allowedChatIds).toEqual([
      111, 222,
    ]);
  });

  it("falha nomeando a variável do telegram que falta", () => {
    const { TELEGRAM_WEBHOOK_SECRET, ...semSegredo } = COMPLETO;
    expect(() => readEnv(semSegredo)).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/env.test.ts`
Expected: FAIL — `telegramBotToken` é `undefined`

- [ ] **Step 3: Implementar**

Em `lib/env.ts`, estenda o tipo e a lista, e acrescente o parser da lista:

```ts
export type Env = {
  supabaseUrl: string;
  supabaseServiceKey: string;
  cronSecret: string;
  telegramBotToken: string;
  telegramWebhookSecret: string;
  allowedChatIds: number[];
};

const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "TELEGRAM_BOT_TOKEN_OFERTAS",
  "TELEGRAM_WEBHOOK_SECRET",
  "ALLOWED_CHAT_IDS",
] as const;

function parseChatIds(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}
```

E no `return`, acrescente os três campos, usando `parseChatIds(source.ALLOWED_CHAT_IDS as string)`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test`
Expected: PASS. Atenção: os testes antigos de `readEnv` passavam objetos com só 3 variáveis e agora vão falhar por variável faltando — **isso é esperado e correto**. Atualize esses testes para usar `COMPLETO`, **sem mudar o que eles verificam** (o teste "falha quando falta variável" continua removendo uma variável e esperando o nome dela no erro).

- [ ] **Step 5: Atualizar o exemplo e commitar**

Acrescente a `.env.local.example` (sem valores):

```
TELEGRAM_BOT_TOKEN_OFERTAS=
TELEGRAM_WEBHOOK_SECRET=
ALLOWED_CHAT_IDS=
```

```bash
git add lib/env.ts .env.local.example tests/env.test.ts
git commit -m "feat(env): variaveis do bot do telegram"
```

---

### Task 2: Cupom deixa de virar preço

**Files:**
- Modify: `lib/parse/price.ts`
- Test: `tests/parse/price.test.ts`

**Interfaces:**
- `parsePrices` mantém a assinatura. Só o conjunto de valores aceitos muda.

**Por que:** os canais anunciam cupom em reais no meio do texto, e como `priceCents` é o **menor** valor, o cupom ganha do preço. Verificado em posts reais do arquivo:

```
"aplicar o cupom R$ 30 OFF na página"          → 3000 virava o preço do S25+
"Aplique R$ 30 OFF no anúncio"                 → 3000 idem
"Resgate o cupom de R$ 80 ... cupom de R$ 500" → 8000 idem
"VALOR DA OFERTA R$ 3.967 - ANTES R$ 4.299"    → 396700 era o certo
```

Isso não gera alerta falso (a faixa tem piso), mas contamina a mediana — que é o número usado para decidir se um preço é bom.

- [ ] **Step 1: Escrever os testes que falham**

```ts
describe("parsePrices — cupom não é preço", () => {
  it("ignora cupom escrito como 'cupom R$ X OFF'", () => {
    const r = parsePrices("aplicar o cupom R$ 30 OFF na página. VALOR DA OFERTA R$ 3.967");
    expect(r.priceCents).toBe(396700);
    expect(r.pricesCents).not.toContain(3000);
  });

  it("ignora 'Aplique R$ 30 OFF no anúncio'", () => {
    const r = parsePrices("Por apenas: R$ 3.967,99\nAplique R$ 30 OFF no anúncio");
    expect(r.priceCents).toBe(396799);
  });

  it("ignora vários cupons no mesmo post", () => {
    const r = parsePrices(
      "Resgate o cupom de R$ 80. Depois o cupom de R$ 500. VALOR DA OFERTA R$ 2.499 - ANTES R$ 3.099",
    );
    expect(r.priceCents).toBe(249900);
    expect(r.pricesCents).toEqual([249900, 309900]);
  });

  it("ignora 'desconto de R$ X'", () => {
    expect(parsePrices("desconto de R$ 50 no PIX. Por R$ 899,00").priceCents).toBe(89900);
  });

  it("não confunde preço legítimo que só menciona a palavra longe do valor", () => {
    const r = parsePrices("Cupom disponível na loja para outros produtos.\n\nPor R$ 1.299,00");
    expect(r.priceCents).toBe(129900);
  });

  it("continua descartando parcela", () => {
    const r = parsePrices("por R$ 3.299,00 à vista ou 12x de R$ 274,91");
    expect(r.pricesCents).toEqual([329900]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/parse/price.test.ts`
Expected: FAIL — os primeiros quatro casos devolvem o valor do cupom

- [ ] **Step 3: Implementar**

Em `lib/parse/price.ts`, acrescente ao lado de `INSTALLMENT_RE`:

```ts
/**
 * Marcador de cupom imediatamente antes do valor. A janela de 24 caracteres é
 * curta de propósito: "cupom de R$ 80" casa, mas um post que cita "cupom" num
 * parágrafo e o preço em outro não é afetado.
 */
const COUPON_BEFORE_RE = /(cupom|desconto|resgate|voucher)[^.\n]{0,14}$/i;
/** "R$ 30 OFF" — o marcador vem DEPOIS do valor. */
const COUPON_AFTER_RE = /^\s*(off|de desconto)\b/i;
```

No laço de `parsePrices`, junto da checagem de parcela:

```ts
const before = text.slice(Math.max(0, at - 24), at);
if (INSTALLMENT_RE.test(before)) continue;
if (COUPON_BEFORE_RE.test(before)) continue;

const after = text.slice(at + match[0].length, at + match[0].length + 16);
if (COUPON_AFTER_RE.test(after)) continue;
```

Atenção: a janela de `INSTALLMENT_RE` era de 12 caracteres. Ela continua funcionando com 24 porque o padrão está ancorado em `$` (fim da janela).

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test`
Expected: PASS, suíte inteira

- [ ] **Step 5: Commit**

```bash
git add lib/parse/price.ts tests/parse/price.test.ts
git commit -m "fix(parse): valor de cupom nao e mais lido como preco do produto"
```

> **Nota:** isto corrige a extração daqui pra frente. Os ~15 mil posts já gravados mantêm o preço errado até serem reprocessados — a Task 9 trata disso.

---

### Task 3: Estatística de preço

**Files:**
- Create: `lib/search/stats.ts`, `tests/search/stats.test.ts`

**Interfaces:**
- Produces: `type PriceStats = { count: number; minCents: number; medianCents: number; maxCents: number }`; `priceStats(cents: number[]): PriceStats | null`

- [ ] **Step 1: Escrever os testes que falham**

`tests/search/stats.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { priceStats } from "@/lib/search/stats";

describe("priceStats", () => {
  it("calcula contagem, mínimo, mediana e máximo", () => {
    expect(priceStats([300, 100, 200])).toEqual({
      count: 3,
      minCents: 100,
      medianCents: 200,
      maxCents: 300,
    });
  });

  it("usa a média dos dois centrais quando a quantidade é par", () => {
    expect(priceStats([100, 200, 300, 400])?.medianCents).toBe(250);
  });

  it("arredonda a mediana para centavo inteiro", () => {
    expect(priceStats([100, 101])?.medianCents).toBe(101);
  });

  it("devolve null para conjunto vazio", () => {
    expect(priceStats([])).toBeNull();
  });

  it("não altera o array recebido", () => {
    const entrada = [300, 100, 200];
    priceStats(entrada);
    expect(entrada).toEqual([300, 100, 200]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/search/stats.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar**

`lib/search/stats.ts`:

```ts
export type PriceStats = {
  count: number;
  minCents: number;
  medianCents: number;
  maxCents: number;
};

/**
 * Estatística do conjunto de preços de uma busca. A mediana é o número que
 * responde "esse preço é bom?" — o mínimo sozinho engana, porque costuma ser
 * um caso atípico.
 */
export function priceStats(cents: number[]): PriceStats | null {
  if (cents.length === 0) return null;
  const ord = [...cents].sort((a, b) => a - b);
  const meio = Math.floor(ord.length / 2);
  const mediana =
    ord.length % 2 === 1 ? ord[meio] : Math.round((ord[meio - 1] + ord[meio]) / 2);
  return {
    count: ord.length,
    minCents: ord[0],
    medianCents: mediana,
    maxCents: ord[ord.length - 1],
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test tests/search/stats.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/search/stats.ts tests/search/stats.test.ts
git commit -m "feat(search): estatistica de preco (min, mediana, max)"
```

---

### Task 4: Busca no arquivo

**Files:**
- Create: `lib/search/query.ts`, `tests/search/query.test.ts`

**Interfaces:**
- Consumes: `priceStats`, `PriceStats` de `lib/search/stats.ts`
- Produces:
```ts
type SearchHit = { text: string; priceCents: number; store: string | null; postedAt: string; url: string };
type SearchResult = { termo: string; stats: PriceStats | null; melhores: SearchHit[] };
buscar(db: SupabaseClient, termo: string, opts?: { meses?: number; limite?: number }): Promise<SearchResult>
```

- [ ] **Step 1: Escrever os testes que falham**

O banco entra por um fake — objeto literal com só os métodos usados. A dependência de Postgres aqui é aparente, não real.

`tests/search/query.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buscar } from "@/lib/search/query";
import type { SupabaseClient } from "@supabase/supabase-js";

function fakeDb(linhas: unknown[]) {
  const chain = {
    select: vi.fn(() => chain),
    textSearch: vi.fn(() => chain),
    not: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve({ data: linhas, error: null })),
  };
  return { from: vi.fn(() => chain), _chain: chain } as unknown as SupabaseClient & {
    _chain: typeof chain;
  };
}

const linha = (priceCents: number, over = {}) => ({
  text: "produto",
  price_cents: priceCents,
  store: "amazon",
  posted_at: "2026-08-01T12:00:00Z",
  url: "https://t.me/x/1",
  ...over,
});

describe("buscar", () => {
  it("devolve estatística e as melhores por preço", async () => {
    const db = fakeDb([linha(100), linha(300), linha(200)]);
    const r = await buscar(db, "air fryer");
    expect(r.stats).toEqual({ count: 3, minCents: 100, medianCents: 200, maxCents: 300 });
    expect(r.melhores.map((m) => m.priceCents)).toEqual([100, 200, 300]);
  });

  it("limita as melhores ao pedido, mas calcula estatística sobre tudo", async () => {
    const db = fakeDb([linha(100), linha(200), linha(300), linha(400), linha(500)]);
    const r = await buscar(db, "mesa", { limite: 2 });
    expect(r.melhores).toHaveLength(2);
    expect(r.stats?.count).toBe(5);
  });

  it("devolve stats null e lista vazia quando não acha nada", async () => {
    const r = await buscar(fakeDb([]), "produto inexistente");
    expect(r.stats).toBeNull();
    expect(r.melhores).toEqual([]);
  });

  it("consulta a tabela posts com busca textual em português", async () => {
    const db = fakeDb([linha(100)]);
    await buscar(db, "calça academia");
    expect(db.from).toHaveBeenCalledWith("posts");
    expect(db._chain.textSearch).toHaveBeenCalledWith(
      "search_vector",
      "calça academia",
      { type: "plain", config: "portuguese" },
    );
  });

  it("propaga erro do banco com o termo na mensagem", async () => {
    const chain = {
      select: vi.fn(() => chain),
      textSearch: vi.fn(() => chain),
      not: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve({ data: null, error: { message: "boom" } })),
    };
    const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
    await expect(buscar(db, "tv")).rejects.toThrow(/tv.*boom/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/search/query.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar**

`lib/search/query.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { type PriceStats, priceStats } from "@/lib/search/stats";

export type SearchHit = {
  text: string;
  priceCents: number;
  store: string | null;
  postedAt: string;
  url: string;
};

export type SearchResult = {
  termo: string;
  stats: PriceStats | null;
  melhores: SearchHit[];
};

const MESES_PADRAO = 6;
const LIMITE_PADRAO = 5;
/** Teto de linhas lidas: a estatística precisa do conjunto todo, mas não do arquivo todo. */
const TETO_LINHAS = 2000;

export async function buscar(
  db: SupabaseClient,
  termo: string,
  opts: { meses?: number; limite?: number } = {},
): Promise<SearchResult> {
  const meses = opts.meses ?? MESES_PADRAO;
  const limite = opts.limite ?? LIMITE_PADRAO;

  const desde = new Date();
  desde.setMonth(desde.getMonth() - meses);

  const { data, error } = await db
    .from("posts")
    .select("text,price_cents,store,posted_at,url")
    .textSearch("search_vector", termo, { type: "plain", config: "portuguese" })
    .not("price_cents", "is", null)
    .gte("posted_at", desde.toISOString())
    .order("price_cents", { ascending: true })
    .limit(TETO_LINHAS);

  if (error) throw new Error(`Buscando "${termo}": ${error.message}`);

  const linhas = (data ?? []) as Array<{
    text: string;
    price_cents: number;
    store: string | null;
    posted_at: string;
    url: string;
  }>;

  const melhores: SearchHit[] = linhas.slice(0, limite).map((l) => ({
    text: l.text,
    priceCents: l.price_cents,
    store: l.store,
    postedAt: l.posted_at,
    url: l.url,
  }));

  return { termo, stats: priceStats(linhas.map((l) => l.price_cents)), melhores };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test tests/search/query.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/search tests/search
git commit -m "feat(search): busca no arquivo com estatistica de preco"
```

---

### Task 5: Cliente do Telegram e formatação

**Files:**
- Create: `lib/telegram.ts`, `lib/bot/format.ts`, `tests/bot/format.test.ts`

**Interfaces:**
- Consumes: `SearchResult`, `SearchHit` de `lib/search/query.ts`; `PriceStats` de `lib/search/stats.ts`
- Produces:
  - `escapeHtml(s: string): string`
  - `sendMessage(token: string, chatId: number, html: string, opts?: { keyboard?: InlineKeyboard }): Promise<void>`
  - `type InlineKeyboard = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }`
  - `formatBRL(cents: number): string`
  - `formatSearch(r: SearchResult): string`
  - `formatAjuda(): string`

- [ ] **Step 1: Escrever os testes que falham**

`tests/bot/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatAjuda, formatBRL, formatSearch } from "@/lib/bot/format";
import { escapeHtml } from "@/lib/telegram";

describe("escapeHtml", () => {
  it("escapa os três caracteres que quebram o HTML do Telegram", () => {
    expect(escapeHtml('a<b>&"')).toBe("a&lt;b&gt;&amp;\"");
  });
});

describe("formatBRL", () => {
  it("formata centavos no padrão brasileiro", () => {
    expect(formatBRL(396799)).toBe("R$ 3.967,99");
  });
  it("formata valor redondo com centavos zerados", () => {
    expect(formatBRL(300000)).toBe("R$ 3.000,00");
  });
});

describe("formatSearch", () => {
  const base = {
    termo: "air fryer",
    stats: { count: 41, minCents: 12900, medianCents: 29700, maxCents: 85994 },
    melhores: [
      {
        text: "Air Fryer 5L Mondial",
        priceCents: 12900,
        store: "amazon",
        postedAt: "2026-08-01T12:00:00Z",
        url: "https://t.me/x/1",
      },
    ],
  };

  it("mostra contagem, mínimo e mediana", () => {
    const s = formatSearch(base);
    expect(s).toContain("41");
    expect(s).toContain("R$ 129,00");
    expect(s).toContain("R$ 297,00");
  });

  it("escapa HTML vindo do texto do post", () => {
    const s = formatSearch({
      ...base,
      melhores: [{ ...base.melhores[0], text: "TV <b>50</b> & mais" }],
    });
    expect(s).toContain("&lt;b&gt;");
    expect(s).not.toContain("<b>50</b>");
  });

  it("responde de forma útil quando não achou nada", () => {
    const s = formatSearch({ termo: "xyzabc", stats: null, melhores: [] });
    expect(s.toLowerCase()).toContain("não achei");
    expect(s).toContain("xyzabc");
  });
});

describe("formatAjuda", () => {
  it("lista os comandos disponíveis", () => {
    const s = formatAjuda();
    for (const cmd of ["/agora", "/cacar", "/cacas", "/ajuda"]) expect(s).toContain(cmd);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/bot/format.test.ts`
Expected: FAIL — módulos não existem

- [ ] **Step 3: Implementar o cliente**

`lib/telegram.ts`:

```ts
export type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

const TIMEOUT_MS = 15_000;

/** Escapa o que o parse_mode HTML do Telegram interpreta. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function chamar(token: string, metodo: string, corpo: unknown): Promise<void> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) {
    throw new Error(`Telegram ${metodo}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
}

export async function sendMessage(
  token: string,
  chatId: number,
  html: string,
  opts: { keyboard?: InlineKeyboard } = {},
): Promise<void> {
  await chamar(token, "sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(opts.keyboard ? { reply_markup: opts.keyboard } : {}),
  });
}

export async function answerCallbackQuery(token: string, id: string): Promise<void> {
  await chamar(token, "answerCallbackQuery", { callback_query_id: id });
}
```

- [ ] **Step 4: Implementar a formatação**

`lib/bot/format.ts`:

```ts
import type { SearchResult } from "@/lib/search/query";
import { escapeHtml } from "@/lib/telegram";

export function formatBRL(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function primeiraLinha(texto: string, max = 70): string {
  const limpo = texto.split("\n").find((l) => l.trim().length > 0) ?? texto;
  const t = limpo.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function formatSearch(r: SearchResult): string {
  if (!r.stats || r.melhores.length === 0) {
    return `Não achei nada para <b>${escapeHtml(r.termo)}</b> nos últimos 6 meses.\n\nTente um termo mais curto — "air fryer" acha mais que "air fryer 5 litros inox".`;
  }

  const linhas = [
    `🔎 <b>${escapeHtml(r.termo)}</b> — ${r.stats.count} ofertas nos últimos 6 meses`,
    `menor ${formatBRL(r.stats.minCents)} · mediana <b>${formatBRL(r.stats.medianCents)}</b> · maior ${formatBRL(r.stats.maxCents)}`,
    "",
  ];

  for (const m of r.melhores) {
    const loja = m.store ? ` · ${escapeHtml(m.store)}` : "";
    linhas.push(
      `<b>${formatBRL(m.priceCents)}</b>${loja} · ${m.postedAt.slice(0, 10)}`,
      `<a href="${escapeHtml(m.url)}">${escapeHtml(primeiraLinha(m.text))}</a>`,
      "",
    );
  }

  linhas.push("<i>A mediana é a régua: preço muito abaixo dela costuma ser acessório, não o produto.</i>");
  return linhas.join("\n");
}

export function formatAjuda(): string {
  return [
    "<b>Caçador de Ofertas</b>",
    "",
    "/agora &lt;produto&gt; — busca no arquivo e mostra menor preço e mediana",
    "/cacar — cria uma caça por conversa; te aviso quando aparecer na faixa",
    "/cacas — lista suas caças, com botão de pausar e excluir",
    "/ajuda — esta mensagem",
    "",
    "<i>Escrever direto, sem comando, faz a mesma coisa que /agora.</i>",
  ].join("\n");
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test`
Expected: PASS, suíte inteira

- [ ] **Step 6: Commit**

```bash
git add lib/telegram.ts lib/bot/format.ts tests/bot/format.test.ts
git commit -m "feat(bot): cliente do telegram e formatacao de mensagens"
```

---

### Task 6: Termos e casamento de caça

**Files:**
- Create: `lib/hunts/terms.ts`, `lib/hunts/match.ts`, `tests/hunts/match.test.ts`

**Interfaces:**
- Produces:
```ts
normalizar(s: string): string                       // minúsculas, sem acento
variantes(consulta: string): string[]               // termos que satisfazem
type Hunt = { id: string; chatId: number; label: string; termsAny: string[]; termsNone: string[]; priceMinCents: number; priceMaxCents: number };
casa(texto: string, priceCents: number | null, hunt: Hunt): boolean
faixaDe(alvoCents: number, tolerancePct: number): { minCents: number; maxCents: number }
```

- [ ] **Step 1: Escrever os testes que falham**

`tests/hunts/match.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { casa, faixaDe } from "@/lib/hunts/match";
import { normalizar, variantes } from "@/lib/hunts/terms";

describe("normalizar", () => {
  it("tira acento e caixa", () => {
    expect(normalizar("Calça AÇÃO")).toBe("calca acao");
  });
});

describe("variantes", () => {
  it("gera a forma com + para 'plus'", () => {
    expect(variantes("s25 plus")).toContain("s25+");
  });
  it("gera a forma com 'plus' quando veio com +", () => {
    expect(variantes("s25+")).toContain("s25 plus");
  });
  it("mantém a consulta original normalizada", () => {
    expect(variantes("Galaxy S25 Plus")).toContain("galaxy s25 plus");
  });
});

describe("faixaDe", () => {
  it("aplica a tolerância em cima do alvo", () => {
    expect(faixaDe(300000, 5)).toEqual({ minCents: 285000, maxCents: 315000 });
  });
  it("tolerância de 10% abre a faixa", () => {
    expect(faixaDe(300000, 10)).toEqual({ minCents: 270000, maxCents: 330000 });
  });
  it("arredonda para centavo inteiro", () => {
    expect(faixaDe(99900, 5).minCents).toBe(94905);
  });
});

const hunt = {
  id: "h1",
  chatId: 1,
  label: "S25+",
  termsAny: ["s25+", "s25 plus"],
  termsNone: ["capa", "pelicula", "seminovo"],
  priceMinCents: 285000,
  priceMaxCents: 315000,
};

describe("casa", () => {
  it("casa produto na faixa", () => {
    expect(casa("Galaxy S25 Plus 256GB por R$ 2.999", 299900, hunt)).toBe(true);
  });
  it("casa ignorando acento e caixa", () => {
    expect(casa("GALAXY S25+ 512GB", 299900, hunt)).toBe(true);
  });
  it("recusa preço abaixo da faixa (a capa de R$29)", () => {
    expect(casa("Capa para Galaxy S25 Plus", 2900, hunt)).toBe(false);
  });
  it("recusa preço acima da faixa", () => {
    expect(casa("Galaxy S25 Plus", 320000, hunt)).toBe(false);
  });
  it("recusa quando bate termo proibido, mesmo na faixa", () => {
    expect(casa("Galaxy S25 Plus seminovo", 299900, hunt)).toBe(false);
  });
  it("recusa quando nenhum termo obrigatório aparece", () => {
    expect(casa("Galaxy S24 Ultra", 299900, hunt)).toBe(false);
  });
  it("recusa post sem preço", () => {
    expect(casa("Galaxy S25 Plus", null, hunt)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/hunts/match.test.ts`
Expected: FAIL — módulos não existem

- [ ] **Step 3: Implementar os termos**

`lib/hunts/terms.ts`:

```ts
/** Minúsculas, sem acento, espaços colapsados. */
export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    // Faixa dos diacríticos combinantes, escrita com escape Unicode de propósito:
    // colar os caracteres combinantes literais no fonte é frágil.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Variações que devem satisfazer a caça. Celular é escrito de dois jeitos
 * ("S25 Plus" e "S25+") e o usuário digita só um deles.
 */
export function variantes(consulta: string): string[] {
  const base = normalizar(consulta);
  const saida = new Set<string>([base]);
  if (base.includes(" plus")) saida.add(base.replace(/ plus/g, "+"));
  if (base.includes("+")) saida.add(base.replace(/\+/g, " plus").replace(/\s+/g, " ").trim());
  return [...saida];
}
```

- [ ] **Step 4: Implementar o matcher**

`lib/hunts/match.ts`:

```ts
import { normalizar } from "@/lib/hunts/terms";

export type Hunt = {
  id: string;
  chatId: number;
  label: string;
  termsAny: string[];
  termsNone: string[];
  priceMinCents: number;
  priceMaxCents: number;
};

/** Faixa a partir do alvo e da tolerância em porcento. Espelha as colunas geradas de `hunts`. */
export function faixaDe(
  alvoCents: number,
  tolerancePct: number,
): { minCents: number; maxCents: number } {
  return {
    minCents: Math.round((alvoCents * (100 - tolerancePct)) / 100),
    maxCents: Math.round((alvoCents * (100 + tolerancePct)) / 100),
  };
}

/**
 * O piso de preço é o que mata acessório sem lista negra infinita: capa de
 * R$29 nunca cai na faixa de um aparelho de R$3.000.
 */
export function casa(texto: string, priceCents: number | null, hunt: Hunt): boolean {
  if (priceCents === null) return false;
  if (priceCents < hunt.priceMinCents || priceCents > hunt.priceMaxCents) return false;

  const t = normalizar(texto);
  if (hunt.termsNone.some((n) => t.includes(normalizar(n)))) return false;
  return hunt.termsAny.some((a) => t.includes(normalizar(a)));
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test tests/hunts/match.test.ts`
Expected: PASS (13 testes)

- [ ] **Step 6: Commit**

```bash
git add lib/hunts tests/hunts
git commit -m "feat(hunts): termos e casamento de caca com faixa de preco"
```

---

### Task 7: Máquina de estados do /cacar

**Files:**
- Create: `lib/bot/flows/new-hunt.ts`, `tests/bot/new-hunt.test.ts`

**Interfaces:**
- Consumes: `faixaDe` de `lib/hunts/match.ts`, `formatBRL` de `lib/bot/format.ts`, `PriceStats` de `lib/search/stats.ts`
- Produces:
```ts
type Step = "ask_product" | "ask_price" | "ask_tolerance" | "confirm";
type FlowData = { produto?: string; alvoCents?: number; tolerancePct?: number };
type FlowOut = { texto: string; keyboard?: InlineKeyboard; proximo: Step | "done" | "cancel"; data: FlowData };
iniciar(): FlowOut
receber(step: Step, data: FlowData, entrada: string, stats: PriceStats | null): FlowOut
```

A função é **pura**: recebe o estado e a entrada, devolve o próximo estado e o texto. Quem fala com o banco e com o Telegram é o router (Task 8).

- [ ] **Step 1: Escrever os testes que falham**

`tests/bot/new-hunt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { iniciar, receber } from "@/lib/bot/flows/new-hunt";

const STATS = { count: 23, minCents: 279900, medianCents: 315000, maxCents: 420000 };

describe("fluxo de nova caça", () => {
  it("começa perguntando o produto", () => {
    const r = iniciar();
    expect(r.proximo).toBe("ask_product");
    expect(r.texto.toLowerCase()).toContain("produto");
  });

  it("depois do produto, mostra a estatística antes de perguntar o preço", () => {
    const r = receber("ask_product", {}, "s25 plus", STATS);
    expect(r.proximo).toBe("ask_price");
    expect(r.texto).toContain("23");
    expect(r.texto).toContain("R$ 3.150,00");
    expect(r.data.produto).toBe("s25 plus");
  });

  it("avisa quando não há histórico, sem travar o fluxo", () => {
    const r = receber("ask_product", {}, "produto raro", null);
    expect(r.proximo).toBe("ask_price");
    expect(r.texto.toLowerCase()).toContain("não achei");
  });

  it("depois do preço, oferece tolerâncias mostrando a faixa de cada uma", () => {
    const r = receber("ask_price", { produto: "s25 plus" }, "3000", STATS);
    expect(r.proximo).toBe("ask_tolerance");
    expect(r.data.alvoCents).toBe(300000);
    const rotulos = r.keyboard?.inline_keyboard.flat().map((b) => b.text).join(" ") ?? "";
    expect(rotulos).toContain("R$ 2.850,00");
    expect(rotulos).toContain("R$ 3.300,00");
  });

  it("aceita preço escrito com vírgula e com R$", () => {
    expect(receber("ask_price", {}, "R$ 3.000,50", STATS).data.alvoCents).toBe(300050);
  });

  it("repete a pergunta quando o preço não é número", () => {
    const r = receber("ask_price", { produto: "x" }, "barato", STATS);
    expect(r.proximo).toBe("ask_price");
    expect(r.texto.toLowerCase()).toContain("número");
  });

  it("depois da tolerância, pede confirmação mostrando a faixa", () => {
    const r = receber("ask_tolerance", { produto: "s25 plus", alvoCents: 300000 }, "10", STATS);
    expect(r.proximo).toBe("confirm");
    expect(r.texto).toContain("R$ 2.700,00");
    expect(r.texto).toContain("R$ 3.300,00");
    expect(r.data.tolerancePct).toBe(10);
  });

  it("confirmando, encerra o fluxo", () => {
    const d = { produto: "s25 plus", alvoCents: 300000, tolerancePct: 10 };
    expect(receber("confirm", d, "sim", STATS).proximo).toBe("done");
  });

  it("recusando, cancela", () => {
    const d = { produto: "s25 plus", alvoCents: 300000, tolerancePct: 10 };
    expect(receber("confirm", d, "não", STATS).proximo).toBe("cancel");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/bot/new-hunt.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar**

`lib/bot/flows/new-hunt.ts`:

```ts
import { formatBRL } from "@/lib/bot/format";
import { faixaDe } from "@/lib/hunts/match";
import type { PriceStats } from "@/lib/search/stats";
import type { InlineKeyboard } from "@/lib/telegram";

export type Step = "ask_product" | "ask_price" | "ask_tolerance" | "confirm";
export type FlowData = { produto?: string; alvoCents?: number; tolerancePct?: number };
export type FlowOut = {
  texto: string;
  keyboard?: InlineKeyboard;
  proximo: Step | "done" | "cancel";
  data: FlowData;
};

const TOLERANCIAS = [5, 10, 15];

/** "R$ 3.000,50" / "3000" / "3.000,50" → centavos. Null se não for número. */
function lerPreco(entrada: string): number | null {
  const limpo = entrada.replace(/r\$/i, "").replace(/\s/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(limpo)) return null;
  const n = Number(limpo.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

export function iniciar(): FlowOut {
  return {
    texto: "Qual <b>produto</b> você quer caçar?\n\n<i>Ex.: s25 plus, air fryer, calça de academia</i>",
    proximo: "ask_product",
    data: {},
  };
}

export function receber(
  step: Step,
  data: FlowData,
  entrada: string,
  stats: PriceStats | null,
): FlowOut {
  const texto = entrada.trim();

  if (step === "ask_product") {
    const contexto = stats
      ? `Achei <b>${stats.count}</b> ofertas nos últimos 6 meses.\nMenor ${formatBRL(stats.minCents)} · mediana <b>${formatBRL(stats.medianCents)}</b>.`
      : "Não achei histórico desse produto ainda — o arquivo cresce todo dia, então isso melhora.";
    return {
      texto: `${contexto}\n\nQuanto você quer pagar?`,
      proximo: "ask_price",
      data: { ...data, produto: texto },
    };
  }

  if (step === "ask_price") {
    const alvo = lerPreco(texto);
    if (alvo === null) {
      return {
        texto: "Não entendi. Manda só o <b>número</b>, ex.: <code>3000</code>",
        proximo: "ask_price",
        data,
      };
    }
    const keyboard: InlineKeyboard = {
      inline_keyboard: [
        TOLERANCIAS.map((pct) => {
          const f = faixaDe(alvo, pct);
          return {
            text: `${pct}% · ${formatBRL(f.minCents)}–${formatBRL(f.maxCents)}`,
            callback_data: `tol:${pct}`,
          };
        }),
      ],
    };
    return {
      texto: "Qual <b>tolerância</b>? Cada opção mostra a faixa que produz:",
      keyboard,
      proximo: "ask_tolerance",
      data: { ...data, alvoCents: alvo },
    };
  }

  if (step === "ask_tolerance") {
    const pct = Number(texto.replace("%", "").trim());
    const alvo = data.alvoCents ?? 0;
    if (!Number.isFinite(pct) || pct <= 0 || pct > 90) {
      return {
        texto: "Tolerância inválida. Manda um número entre 1 e 90, ex.: <code>10</code>",
        proximo: "ask_tolerance",
        data,
      };
    }
    const f = faixaDe(alvo, pct);
    return {
      texto: `Vou caçar <b>${data.produto}</b> entre <b>${formatBRL(f.minCents)}</b> e <b>${formatBRL(f.maxCents)}</b> (±${pct}%).\n\nConfirma? Responda <b>sim</b> ou <b>não</b>.`,
      proximo: "confirm",
      data: { ...data, tolerancePct: pct },
    };
  }

  const sim = /^(s|sim|ok|isso|confirma)/i.test(texto);
  return {
    texto: sim ? "Caça criada." : "Cancelado.",
    proximo: sim ? "done" : "cancel",
    data,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test tests/bot/new-hunt.test.ts`
Expected: PASS (9 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/bot/flows tests/bot/new-hunt.test.ts
git commit -m "feat(bot): maquina de estados da conversa que cria caca"
```

---

### Task 8: Sessões, router e webhook

**Files:**
- Create: `lib/bot/session.ts`, `lib/bot/hunts-repo.ts`, `lib/bot/router.ts`, `app/api/telegram/webhook/route.ts`, `tests/bot/router.test.ts`

**Interfaces:**
- Consumes: tudo das Tasks 4–7
- Produces:
```ts
// session.ts
lerSessao(db, chatId): Promise<{ step: Step; data: FlowData } | null>
salvarSessao(db, chatId, step, data, agora: Date): Promise<void>
limparSessao(db, chatId): Promise<void>
// hunts-repo.ts
criarHunt(db, chatId, produto, alvoCents, tolerancePct): Promise<void>
listarHunts(db, chatId): Promise<Array<{ id: string; label: string; priceMinCents: number; priceMaxCents: number; isActive: boolean }>>
desativarHunt(db, huntId): Promise<void>
// router.ts
type Update = { message?: { chat: { id: number }; text?: string }; callback_query?: { id: string; data?: string; message?: { chat: { id: number } } } };
extrairEntrada(u: Update): { chatId: number; texto: string; callbackId?: string } | null
autorizado(chatId: number, permitidos: number[]): boolean
tratar(db, token, entrada): Promise<void>
```

- [ ] **Step 1: Escrever os testes que falham**

Testam as partes puras do router. `tratar` conversa com banco e Telegram e é exercitada manualmente no Step 6.

`tests/bot/router.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { autorizado, extrairEntrada } from "@/lib/bot/router";

describe("extrairEntrada", () => {
  it("lê mensagem de texto", () => {
    expect(extrairEntrada({ message: { chat: { id: 7 }, text: "oi" } })).toEqual({
      chatId: 7,
      texto: "oi",
      callbackId: undefined,
    });
  });

  it("lê clique de botão, trazendo o callback_data como texto", () => {
    const r = extrairEntrada({
      callback_query: { id: "cb1", data: "tol:10", message: { chat: { id: 7 } } },
    });
    expect(r).toEqual({ chatId: 7, texto: "10", callbackId: "cb1" });
  });

  it("devolve null para update sem texto nem callback", () => {
    expect(extrairEntrada({})).toBeNull();
  });

  it("devolve null para mensagem sem texto (foto, sticker)", () => {
    expect(extrairEntrada({ message: { chat: { id: 7 } } })).toBeNull();
  });
});

describe("autorizado", () => {
  it("aceita chat da allowlist", () => {
    expect(autorizado(7, [7, 9])).toBe(true);
  });
  it("recusa chat de fora", () => {
    expect(autorizado(8, [7, 9])).toBe(false);
  });
  it("recusa tudo quando a allowlist está vazia", () => {
    expect(autorizado(7, [])).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/bot/router.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar sessões**

`lib/bot/session.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FlowData, Step } from "@/lib/bot/flows/new-hunt";

const EXPIRA_MIN = 10;

export async function lerSessao(
  db: SupabaseClient,
  chatId: number,
): Promise<{ step: Step; data: FlowData } | null> {
  const { data, error } = await db
    .from("bot_sessions")
    .select("step,data,expires_at")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (error) throw new Error(`Lendo sessão de ${chatId}: ${error.message}`);
  if (!data) return null;
  if (new Date(data.expires_at as string) < new Date()) return null;
  return { step: data.step as Step, data: data.data as FlowData };
}

export async function salvarSessao(
  db: SupabaseClient,
  chatId: number,
  step: Step,
  dados: FlowData,
  agora: Date,
): Promise<void> {
  const expira = new Date(agora.getTime() + EXPIRA_MIN * 60_000);
  const { error } = await db.from("bot_sessions").upsert(
    {
      chat_id: chatId,
      flow: "new_hunt",
      step,
      data: dados,
      updated_at: agora.toISOString(),
      expires_at: expira.toISOString(),
    },
    { onConflict: "chat_id" },
  );
  if (error) throw new Error(`Salvando sessão de ${chatId}: ${error.message}`);
}

export async function limparSessao(db: SupabaseClient, chatId: number): Promise<void> {
  const { error } = await db.from("bot_sessions").delete().eq("chat_id", chatId);
  if (error) throw new Error(`Limpando sessão de ${chatId}: ${error.message}`);
}
```

- [ ] **Step 4: Implementar o repositório de caças**

`lib/bot/hunts-repo.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { variantes } from "@/lib/hunts/terms";

/** Termos que quase sempre indicam acessório ou item usado, não o produto. */
const PROIBIDOS_PADRAO = [
  "capa", "pelicula", "película", "carregador", "cabo", "suporte",
  "seminovo", "semi-novo", "recondicionado", "vitrine", "usado",
];

export async function criarHunt(
  db: SupabaseClient,
  chatId: number,
  produto: string,
  alvoCents: number,
  tolerancePct: number,
): Promise<void> {
  const { error } = await db.from("hunts").insert({
    chat_id: chatId,
    label: produto,
    query: produto,
    terms_any: variantes(produto),
    terms_none: PROIBIDOS_PADRAO,
    target_cents: alvoCents,
    tolerance_pct: tolerancePct,
  });
  if (error) throw new Error(`Criando caça "${produto}": ${error.message}`);
}

export async function listarHunts(
  db: SupabaseClient,
  chatId: number,
): Promise<
  Array<{ id: string; label: string; priceMinCents: number; priceMaxCents: number; isActive: boolean }>
> {
  const { data, error } = await db
    .from("hunts")
    .select("id,label,price_min_cents,price_max_cents,is_active")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Listando caças de ${chatId}: ${error.message}`);
  return (data ?? []).map((h) => ({
    id: h.id as string,
    label: h.label as string,
    priceMinCents: h.price_min_cents as number,
    priceMaxCents: h.price_max_cents as number,
    isActive: h.is_active as boolean,
  }));
}

export async function desativarHunt(db: SupabaseClient, huntId: string): Promise<void> {
  const { error } = await db.from("hunts").update({ is_active: false }).eq("id", huntId);
  if (error) throw new Error(`Desativando caça ${huntId}: ${error.message}`);
}
```

- [ ] **Step 5: Implementar o router e a rota**

`lib/bot/router.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatAjuda, formatBRL, formatSearch } from "@/lib/bot/format";
import { iniciar, receber, type Step } from "@/lib/bot/flows/new-hunt";
import { criarHunt, desativarHunt, listarHunts } from "@/lib/bot/hunts-repo";
import { lerSessao, limparSessao, salvarSessao } from "@/lib/bot/session";
import { buscar } from "@/lib/search/query";
import { answerCallbackQuery, sendMessage } from "@/lib/telegram";

export type Update = {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
};

export type Entrada = { chatId: number; texto: string; callbackId?: string };

/** Clique de botão vira texto: `tol:10` → `10`, `del:<id>` → `del:<id>`. */
export function extrairEntrada(u: Update): Entrada | null {
  const cb = u.callback_query;
  if (cb?.message?.chat.id !== undefined && cb.data) {
    const texto = cb.data.startsWith("tol:") ? cb.data.slice(4) : cb.data;
    return { chatId: cb.message.chat.id, texto, callbackId: cb.id };
  }
  const m = u.message;
  if (m?.text) return { chatId: m.chat.id, texto: m.text, callbackId: undefined };
  return null;
}

export function autorizado(chatId: number, permitidos: number[]): boolean {
  return permitidos.includes(chatId);
}

export async function tratar(
  db: SupabaseClient,
  token: string,
  entrada: Entrada,
): Promise<void> {
  const { chatId, texto } = entrada;
  if (entrada.callbackId) await answerCallbackQuery(token, entrada.callbackId);

  if (texto.startsWith("del:")) {
    await desativarHunt(db, texto.slice(4));
    await sendMessage(token, chatId, "Caça desativada.");
    return;
  }

  const comando = texto.trim().split(/\s+/)[0].toLowerCase();

  if (comando === "/ajuda" || comando === "/start") {
    await limparSessao(db, chatId);
    await sendMessage(token, chatId, formatAjuda());
    return;
  }

  if (comando === "/cacas") {
    const hs = (await listarHunts(db, chatId)).filter((h) => h.isActive);
    if (hs.length === 0) {
      await sendMessage(token, chatId, "Nenhuma caça ativa. Use /cacar para criar.");
      return;
    }
    const linhas = hs.map(
      (h) => `• <b>${h.label}</b> — ${formatBRL(h.priceMinCents)} a ${formatBRL(h.priceMaxCents)}`,
    );
    await sendMessage(token, chatId, linhas.join("\n"), {
      keyboard: {
        inline_keyboard: hs.map((h) => [{ text: `Excluir ${h.label}`, callback_data: `del:${h.id}` }]),
      },
    });
    return;
  }

  if (comando === "/cacar") {
    const out = iniciar();
    await salvarSessao(db, chatId, "ask_product", out.data, new Date());
    await sendMessage(token, chatId, out.texto);
    return;
  }

  if (comando === "/agora") {
    const termo = texto.slice(comando.length).trim();
    if (!termo) {
      await sendMessage(token, chatId, "Use assim: <code>/agora air fryer</code>");
      return;
    }
    await sendMessage(token, chatId, formatSearch(await buscar(db, termo)));
    return;
  }

  const sessao = await lerSessao(db, chatId);
  if (sessao) {
    // O passo que pede o produto precisa da estatística para o passo seguinte.
    const stats =
      sessao.step === "ask_product" ? (await buscar(db, texto)).stats : null;
    const out = receber(sessao.step, sessao.data, texto, stats);

    if (out.proximo === "done") {
      await criarHunt(
        db,
        chatId,
        out.data.produto as string,
        out.data.alvoCents as number,
        out.data.tolerancePct as number,
      );
      await limparSessao(db, chatId);
      await sendMessage(token, chatId, "✅ Caça criada. Te aviso quando aparecer.");
      return;
    }
    if (out.proximo === "cancel") {
      await limparSessao(db, chatId);
      await sendMessage(token, chatId, out.texto);
      return;
    }
    await salvarSessao(db, chatId, out.proximo as Step, out.data, new Date());
    await sendMessage(token, chatId, out.texto, { keyboard: out.keyboard });
    return;
  }

  // Texto livre sem sessão = busca.
  await sendMessage(token, chatId, formatSearch(await buscar(db, texto)));
}
```

`app/api/telegram/webhook/route.ts`:

```ts
import { NextResponse } from "next/server";
import { autorizado, extrairEntrada, tratar, type Update } from "@/lib/bot/router";
import { createDb } from "@/lib/db/client";
import { readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const env = readEnv();

  if (req.headers.get("x-telegram-bot-api-secret-token") !== env.telegramWebhookSecret) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const update = (await req.json()) as Update;
  const entrada = extrairEntrada(update);
  // Sempre 200: o Telegram reenfileira em erro, e update que não sabemos tratar
  // reenviado para sempre vira laço infinito.
  if (!entrada || !autorizado(entrada.chatId, env.allowedChatIds)) {
    return NextResponse.json({ ok: true });
  }

  try {
    await tratar(createDb(), env.telegramBotToken, entrada);
  } catch (e) {
    console.error("Erro tratando update:", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm build`
Expected: os três passam; a rota `/api/telegram/webhook` aparece no build

- [ ] **Step 7: Commit**

```bash
git add lib/bot app/api/telegram tests/bot/router.test.ts
git commit -m "feat(bot): sessoes, router de comandos e rota de webhook"
```

---

### Task 9: Alertas dentro do tick

**Files:**
- Create: `lib/cron/alerts.ts`, `tests/cron/alerts.test.ts`
- Modify: `app/api/cron/tick/route.ts`
- Create: `supabase/migrations/0004_reprocessa_precos.sql`

**Interfaces:**
- Consumes: `casa`, `Hunt` de `lib/hunts/match.ts`; `sendMessage` de `lib/telegram.ts`; `formatBRL` de `lib/bot/format.ts`
- Produces: `formatAlerta(hunt, post): string`; `processarAlertas(db, token, agora): Promise<{ casados: number; enviados: number; falhos: number }>`

**Desenho da entrega:** a linha em `alerts` é gravada **antes** do envio, com `sent_at` nulo. Se o Telegram falhar ou a função morrer no meio, o alerta fica pendente e o próximo tick reenvia. Marcar como enviado antes de enviar perderia alerta em silêncio, que é o pior modo de falha aqui. O `unique (hunt_id, post_row_id)` garante que você nunca recebe o mesmo alerta duas vezes.

- [ ] **Step 1: Escrever os testes que falham**

`tests/cron/alerts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatAlerta } from "@/lib/cron/alerts";

const hunt = {
  id: "h1",
  chatId: 7,
  label: "Galaxy S25+",
  termsAny: ["s25+"],
  termsNone: [],
  priceMinCents: 285000,
  priceMaxCents: 315000,
};

const post = {
  rowId: 1,
  text: "Galaxy S25+ 256GB\nPor R$ 2.899,00",
  priceCents: 289900,
  store: "amazon",
  url: "https://t.me/x/1",
  postedAt: "2026-08-10T15:00:00Z",
};

describe("formatAlerta", () => {
  it("mostra o rótulo da caça e o preço", () => {
    const s = formatAlerta(hunt, post);
    expect(s).toContain("Galaxy S25+");
    expect(s).toContain("R$ 2.899,00");
  });

  it("mostra a loja e o link do post", () => {
    const s = formatAlerta(hunt, post);
    expect(s).toContain("amazon");
    expect(s).toContain("https://t.me/x/1");
  });

  it("escapa HTML vindo do texto do post", () => {
    const s = formatAlerta(hunt, { ...post, text: "TV <b>50</b> & tal" });
    expect(s).toContain("&lt;b&gt;");
  });

  it("diz quanto está abaixo do teto da faixa", () => {
    // teto 315000, preço 289900 → 8% abaixo
    expect(formatAlerta(hunt, post)).toMatch(/8%/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/cron/alerts.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar**

`lib/cron/alerts.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatBRL } from "@/lib/bot/format";
import { casa, type Hunt } from "@/lib/hunts/match";
import { escapeHtml, sendMessage } from "@/lib/telegram";

export type AlertPost = {
  rowId: number;
  text: string;
  priceCents: number;
  store: string | null;
  url: string;
  postedAt: string;
};

const MAX_TENTATIVAS = 5;
/** Quantos posts recentes o casamento examina por tick. */
const JANELA_POSTS = 500;

export function formatAlerta(hunt: Hunt, post: AlertPost): string {
  const abaixo = Math.round((1 - post.priceCents / hunt.priceMaxCents) * 100);
  const loja = post.store ? ` · ${escapeHtml(post.store)}` : "";
  const primeira =
    post.text.split("\n").find((l) => l.trim().length > 0)?.trim().slice(0, 80) ?? "";
  return [
    `🎯 <b>${escapeHtml(hunt.label)}</b>`,
    `<b>${formatBRL(post.priceCents)}</b> — ${abaixo}% abaixo do teto da sua faixa${loja}`,
    `${escapeHtml(primeira)}`,
    `<a href="${escapeHtml(post.url)}">ver post</a>`,
  ].join("\n");
}

function toHunt(row: Record<string, unknown>): Hunt {
  return {
    id: row.id as string,
    chatId: row.chat_id as number,
    label: row.label as string,
    termsAny: row.terms_any as string[],
    termsNone: row.terms_none as string[],
    priceMinCents: row.price_min_cents as number,
    priceMaxCents: row.price_max_cents as number,
  };
}

export async function processarAlertas(
  db: SupabaseClient,
  token: string,
  agora: Date,
): Promise<{ casados: number; enviados: number; falhos: number }> {
  const { data: huntRows, error: huntErr } = await db
    .from("hunts")
    .select("*")
    .eq("is_active", true);
  if (huntErr) throw new Error(`Lendo caças: ${huntErr.message}`);
  const hunts = (huntRows ?? []).map(toHunt);

  let casados = 0;
  if (hunts.length > 0) {
    const { data: postRows, error: postErr } = await db
      .from("posts")
      .select("id,text,price_cents,store,url,posted_at")
      .not("price_cents", "is", null)
      .order("id", { ascending: false })
      .limit(JANELA_POSTS);
    if (postErr) throw new Error(`Lendo posts para alerta: ${postErr.message}`);

    const novos: Array<{ hunt_id: string; post_row_id: number }> = [];
    for (const p of postRows ?? []) {
      for (const h of hunts) {
        if (casa(p.text as string, p.price_cents as number, h)) {
          novos.push({ hunt_id: h.id, post_row_id: p.id as number });
        }
      }
    }
    if (novos.length > 0) {
      // ignoreDuplicates + unique(hunt_id, post_row_id): reprocessar não duplica alerta.
      const { error } = await db
        .from("alerts")
        .upsert(novos, { onConflict: "hunt_id,post_row_id", ignoreDuplicates: true });
      if (error) throw new Error(`Gravando alertas: ${error.message}`);
      casados = novos.length;
    }
  }

  const { data: pendentes, error: pendErr } = await db
    .from("alerts")
    .select("id,hunt_id,post_row_id,attempts")
    .is("sent_at", null)
    .lt("attempts", MAX_TENTATIVAS)
    .limit(30);
  if (pendErr) throw new Error(`Lendo alertas pendentes: ${pendErr.message}`);

  let enviados = 0;
  let falhos = 0;
  for (const a of pendentes ?? []) {
    try {
      const { data: hRow } = await db.from("hunts").select("*").eq("id", a.hunt_id).single();
      const { data: pRow } = await db
        .from("posts")
        .select("id,text,price_cents,store,url,posted_at")
        .eq("id", a.post_row_id)
        .single();
      if (!hRow || !pRow) throw new Error("caça ou post sumiu");

      const hunt = toHunt(hRow);
      await sendMessage(token, hunt.chatId, formatAlerta(hunt, {
        rowId: pRow.id as number,
        text: pRow.text as string,
        priceCents: pRow.price_cents as number,
        store: pRow.store as string | null,
        url: pRow.url as string,
        postedAt: pRow.posted_at as string,
      }));
      await db.from("alerts").update({ sent_at: agora.toISOString() }).eq("id", a.id);
      await db.from("hunts").update({ last_alert_at: agora.toISOString() }).eq("id", hunt.id);
      enviados++;
    } catch (e) {
      falhos++;
      console.error("Falha ao entregar alerta:", e instanceof Error ? e.message : e);
      await db
        .from("alerts")
        .update({ attempts: ((a.attempts as number) ?? 0) + 1 })
        .eq("id", a.id);
    }
  }

  return { casados, enviados, falhos };
}
```

- [ ] **Step 4: Ligar no tick**

Em `app/api/cron/tick/route.ts`, depois do bloco do canário e antes do `return` de sucesso:

```ts
let alertas = { casados: 0, enviados: 0, falhos: 0 };
try {
  alertas = await processarAlertas(createDb(), readEnv().telegramBotToken, new Date());
} catch (e) {
  console.error("Falha ao processar alertas:", e instanceof Error ? e.message : e);
}
```

E inclua `alertas` no JSON de resposta. Importa que esse `try/catch` seja separado: alerta quebrado não pode impedir a coleta, que é a função principal do tick.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm build`
Expected: os três passam

- [ ] **Step 6: Migration que reprocessa os preços errados**

`supabase/migrations/0004_reprocessa_precos.sql` — a correção da Task 2 vale para posts novos; os já gravados com valor de cupom continuam errados e contaminam a mediana. Como o parser vive no TypeScript, o SQL só marca os suspeitos para reprocessamento futuro; a limpeza barata é apagar o preço obviamente incorreto:

```sql
-- Posts cujo preço registrado é um valor de cupom: o texto menciona cupom/OFF
-- perto de um valor pequeno, e existe outro preço bem maior no mesmo post.
-- Zerar price_cents é preferível a manter valor errado: a busca ignora post
-- sem preço, e a mediana deixa de ser contaminada.
update posts
set price_cents = null
where price_cents is not null
  and price_cents < 50000
  and array_length(prices_cents, 1) > 1
  and (prices_cents)[array_length(prices_cents, 1)] > price_cents * 10
  and text ~* '(cupom|desconto|resgate|off)';
```

Rode no SQL Editor e confira o número de linhas afetadas.

- [ ] **Step 7: Commit**

```bash
git add lib/cron/alerts.ts tests/cron/alerts.test.ts app/api/cron/tick/route.ts supabase/migrations/0004_reprocessa_precos.sql
git commit -m "feat(cron): casa cacas e entrega alertas dentro do tick"
```

---

### Task 10: Publicar e registrar o webhook

**Files:**
- Modify: `docs/OPERATIONS.md`

**Interfaces:**
- Consumes: tudo

- [ ] **Step 1: Gerar o segredo do webhook**

```bash
cd ~/Vile/Foco/Projetosjm/cacador-ofertas
echo "TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)" >> .env.local
```

- [ ] **Step 2: Variáveis na Vercel**

Em Settings → Environment Variables (Production), acrescente às que já existem:
`TELEGRAM_WEBHOOK_SECRET`, `ALLOWED_CHAT_IDS`.
Confirme que `TELEGRAM_BOT_TOKEN_OFERTAS` já está lá.

Depois: **Deployments → o último → Redeploy.** Variável nova não vale para deploy existente.

- [ ] **Step 3: Registrar o webhook no Telegram**

```bash
TOKEN=$(grep '^TELEGRAM_BOT_TOKEN_OFERTAS=' .env.local | cut -d= -f2-)
WH=$(grep '^TELEGRAM_WEBHOOK_SECRET=' .env.local | cut -d= -f2-)
curl -s -X POST "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -H "content-type: application/json" \
  -d "{\"url\":\"https://vai-gerar.vercel.app/api/telegram/webhook\",\"secret_token\":\"${WH}\",\"allowed_updates\":[\"message\",\"callback_query\"]}"
```

Expected: `{"ok":true,"result":true,...}`

Confira: `curl -s "https://api.telegram.org/bot${TOKEN}/getWebhookInfo"` deve mostrar a URL e `pending_update_count` baixo.

- [ ] **Step 4: Teste de aceitação, no Telegram de verdade**

Mande para o `@Vaigerarviubot`, em ordem:

1. `/ajuda` → lista os comandos
2. `/agora galaxy s25` → contagem, menor preço, mediana e as 5 melhores
3. `/cacar` → responda `s25 plus`, depois `3000`, depois clique em `10%`, depois `sim`
4. `/cacas` → mostra a caça criada com a faixa R$ 2.700–3.300 e botão de excluir

Se algum passo travar, olhe o log da função em Vercel → Deployments → Functions.

- [ ] **Step 5: Atualizar o runbook**

Em `docs/OPERATIONS.md`, acrescente uma seção sobre o bot: as variáveis novas, como registrar o webhook, e o diagnóstico — **webhook devolvendo 401 quase sempre é `TELEGRAM_WEBHOOK_SECRET` divergente entre a Vercel e o `setWebhook`**; o bot ficar mudo sem erro costuma ser `chat_id` fora de `ALLOWED_CHAT_IDS`, que responde 200 de propósito para não gerar reenvio infinito.

- [ ] **Step 6: Commit**

```bash
git add docs/OPERATIONS.md
git commit -m "docs(ops): runbook do bot e registro do webhook"
```

---

## Pronto quando

- `pnpm test`, `pnpm exec tsc --noEmit` e `pnpm build` passam.
- `/agora galaxy s25` responde com contagem, menor preço e mediana.
- Dá para criar, listar e excluir caça inteiramente pelo chat.
- Uma caça com faixa propositalmente larga dispara alerta no tick seguinte, e **não repete** no tick depois.
- Sessão abandonada expira em 10 minutos sem travar o bot.

## Fora de escopo (fica para depois)

- **Resumo diário**, `/resumo` e `/config` — dependem do agregador diário, que não existe ainda. Comando que configura funcionalidade inexistente é ruído.
- **Ranquear por distância da mediana** para afundar acessório na busca (`docs/PLANO.md`, defeito 2). A faixa de preço já resolve isso no alerta; na busca continua aparecendo.
- **Segundo bot** (`TELEGRAM_BOT_TOKEN_CHINA`) e roteamento por `bot_key`. O schema aguenta; nada aqui usa.
