# Caçador de Ofertas — Etapa A (Ingestor + Arquivo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coletar continuamente os posts dos canais de oferta do Telegram, extrair preço e loja, e guardar num arquivo Postgres pesquisável — com backfill do histórico já existente.

**Architecture:** App Next.js 15 (App Router) na Vercel. Duas rotas de cron autenticadas por header `x-cron-secret` batem em módulos puros de parsing (sem I/O) que transformam o HTML de `t.me/s/<canal>` em linhas de `posts`. Cursor por canal (`last_post_id` pra frente, `backfill_cursor` pra trás) torna a coleta idempotente e imune a atraso de agendamento.

**Tech Stack:** Next.js 15.5, TypeScript, Vitest, Biome, Supabase (Postgres + `@supabase/supabase-js`), pnpm.

## Global Constraints

- **Dinheiro sempre em centavos (`integer`).** Nunca float, nunca reais.
- **Módulos em `lib/parse/`, `lib/collector/parse.ts` e `lib/digest/` são puros** — sem `fetch`, sem cliente de banco, sem `Date.now()` implícito em assinatura. É onde ficam os testes.
- **Nada de `any`.** Biome trata como warning; o plano não introduz nenhum.
- **Cliente Supabase é sempre `service_role`, só no servidor.** O projeto é mono-usuário e não usa RLS.
- **Migrations rodam manualmente** no SQL Editor do Supabase, em ordem numérica.
- **Node 20+**, pnpm como gerenciador.
- **Fuso das datas de negócio é `America/Sao_Paulo`**; `timestamptz` no banco guarda UTC.
- Spec de referência: `docs/superpowers/specs/2026-08-05-cacador-ofertas-design.md`

---

### Task 1: Bootstrap do projeto

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `biome.json`, `vitest.config.ts`, `.gitignore`, `.env.local.example`, `lib/env.ts`, `tests/env.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `readEnv(): Env` de `lib/env.ts`, com `Env = { supabaseUrl: string; supabaseServiceKey: string; cronSecret: string }`

- [ ] **Step 1: Criar o projeto e instalar dependências**

```bash
cd ~/Vile/Foco/Projetosjm/cacador-ofertas
pnpm init
pnpm add next@15.5.15 react@19.0.0 react-dom@19.0.0 @supabase/supabase-js@^2.107.0
pnpm add -D typescript @types/node @types/react vitest @biomejs/biome
```

- [ ] **Step 2: Escrever os arquivos de configuração**

`package.json` (substitua a seção `scripts`):

```json
{
  "scripts": {
    "dev": "next dev -p 3010",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "biome check --write ."
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "@": resolve(__dirname, ".") } },
});
```

`next.config.ts`:

```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {};
export default nextConfig;
```

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "files": { "includes": ["**", "!**/node_modules", "!**/.next", "!**/tests/fixtures"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true } }
}
```

`.gitignore`:

```
node_modules
.next
.env.local
*.tsbuildinfo
next-env.d.ts
```

`.env.local.example`:

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
```

- [ ] **Step 3: Escrever o teste de env que falha**

`tests/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readEnv } from "@/lib/env";

describe("readEnv", () => {
  it("lê as variáveis quando todas estão presentes", () => {
    const env = readEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "key",
      CRON_SECRET: "secret",
    });
    expect(env.supabaseUrl).toBe("https://x.supabase.co");
    expect(env.cronSecret).toBe("secret");
  });

  it("falha alto quando falta variável, dizendo qual", () => {
    expect(() => readEnv({ SUPABASE_URL: "https://x.supabase.co" })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `pnpm test`
Expected: FAIL — `Cannot find module '@/lib/env'`

- [ ] **Step 5: Implementar `lib/env.ts`**

```ts
export type Env = {
  supabaseUrl: string;
  supabaseServiceKey: string;
  cronSecret: string;
};

const REQUIRED = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"] as const;

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const missing = REQUIRED.filter((k) => !source[k]);
  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente faltando: ${missing.join(", ")}`);
  }
  return {
    supabaseUrl: source.SUPABASE_URL as string,
    supabaseServiceKey: source.SUPABASE_SERVICE_ROLE_KEY as string,
    cronSecret: source.CRON_SECRET as string,
  };
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm test`
Expected: PASS (2 testes)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: bootstrap do projeto (next, vitest, biome, env)"
```

---

### Task 2: Schema no Supabase

**Files:**
- Create: `supabase/migrations/0001_schema.sql`, `lib/db/client.ts`, `lib/db/types.ts`, `scripts/check-schema.mjs`

**Interfaces:**
- Consumes: `readEnv()` da Task 1
- Produces: `createDb(): SupabaseClient` de `lib/db/client.ts`; tipos `ChannelRow`, `PostRow` de `lib/db/types.ts`

- [ ] **Step 1: Escrever a migration**

As tabelas das Etapas C e D entram já agora: migration manual em ordem numérica fica mais simples num arquivo só, e nada desta etapa lê ou escreve nelas.

`supabase/migrations/0001_schema.sql`:

```sql
create table channels (
  slug              text primary key,
  title             text,
  kind              text not null check (kind in ('tech', 'china')),
  is_active         boolean not null default true,
  last_post_id      bigint not null default 0,
  backfill_cursor   bigint,
  backfill_complete boolean not null default false,
  created_at        timestamptz not null default now()
);

create table posts (
  id             bigserial primary key,
  channel_slug   text not null references channels(slug),
  post_id        bigint not null,
  posted_at      timestamptz not null,
  text           text not null,
  url            text not null,
  price_cents    integer,
  prices_cents   integer[] not null default '{}',
  store          text,
  product_url    text,
  search_vector  tsvector generated always as (to_tsvector('portuguese', text)) stored,
  created_at     timestamptz not null default now(),
  unique (channel_slug, post_id)
);
create index posts_search_idx on posts using gin(search_vector);
create index posts_posted_idx on posts (posted_at desc);
create index posts_price_idx  on posts (price_cents) where price_cents is not null;

create table hunts (
  id               uuid primary key default gen_random_uuid(),
  chat_id          bigint not null,
  bot_key          text not null default 'ofertas',
  label            text not null,
  query            text not null,
  terms_any        text[] not null,
  terms_all        text[] not null default '{}',
  terms_none       text[] not null default '{}',
  target_cents     integer not null,
  tolerance_pct    numeric(5,2) not null default 5.0,
  price_min_cents  integer generated always as
                     (round(target_cents * (100 - tolerance_pct) / 100)::integer) stored,
  price_max_cents  integer generated always as
                     (round(target_cents * (100 + tolerance_pct) / 100)::integer) stored,
  channels         text[] not null default '{}',
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  last_alert_at    timestamptz
);

create table alerts (
  id           bigserial primary key,
  hunt_id      uuid not null references hunts(id) on delete cascade,
  post_row_id  bigint not null references posts(id) on delete cascade,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  attempts     integer not null default 0,
  unique (hunt_id, post_row_id)
);

create table user_settings (
  chat_id            bigint primary key,
  tolerance_default  numeric(5,2) not null default 5.0,
  digest_enabled     boolean not null default true,
  digest_hour        smallint not null default 20,
  digest_sent_on     date,
  search_months      smallint not null default 6
);

create table bot_sessions (
  chat_id     bigint primary key,
  flow        text not null,
  step        text not null,
  data        jsonb not null default '{}',
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
```

- [ ] **Step 2: Rodar a migration**

No dashboard do Supabase → **SQL Editor** → **New query** → cole o conteúdo de `0001_schema.sql` → **Run**.
Expected: `Success. No rows returned`

- [ ] **Step 3: Escrever tipos e cliente**

`lib/db/types.ts`:

```ts
export type ChannelRow = {
  slug: string;
  title: string | null;
  kind: "tech" | "china";
  is_active: boolean;
  last_post_id: number;
  backfill_cursor: number | null;
  backfill_complete: boolean;
};

export type PostRow = {
  channel_slug: string;
  post_id: number;
  posted_at: string;
  text: string;
  url: string;
  price_cents: number | null;
  prices_cents: number[];
  store: string | null;
  product_url: string | null;
};
```

`lib/db/client.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readEnv } from "@/lib/env";

export function createDb(): SupabaseClient {
  const env = readEnv();
  return createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 4: Escrever o script de verificação**

`scripts/check-schema.mjs`:

```js
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const tables = ["channels", "posts", "hunts", "alerts", "user_settings", "bot_sessions"];
let ok = true;
for (const t of tables) {
  const { error } = await db.from(t).select("*").limit(0);
  console.log(error ? `FALHOU ${t}: ${error.message}` : `ok ${t}`);
  if (error) ok = false;
}
process.exit(ok ? 0 : 1);
```

- [ ] **Step 5: Rodar a verificação**

Preencha `.env.local` com os valores do Supabase (Settings → API) e rode:

Run: `node scripts/check-schema.mjs`
Expected: seis linhas `ok`, exit 0

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): schema inicial e cliente supabase"
```

---

### Task 3: Extração de preço

**Files:**
- Create: `lib/parse/price.ts`, `tests/parse/price.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `htmlToText(html: string): string`; `toCents(raw: string): number | null`; `parsePrices(html: string): { pricesCents: number[]; priceCents: number | null }`

- [ ] **Step 1: Escrever os testes que falham**

`tests/parse/price.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { htmlToText, parsePrices, toCents } from "@/lib/parse/price";

describe("toCents", () => {
  it("converte formato BR com centavos", () => {
    expect(toCents("3.149,10")).toBe(314910);
  });
  it("converte sem centavos, ponto é milhar", () => {
    expect(toCents("2.000")).toBe(200000);
  });
  it("converte número curto", () => {
    expect(toCents("299")).toBe(29900);
  });
});

describe("htmlToText", () => {
  it("remove trecho riscado antes de virar texto", () => {
    expect(htmlToText("De <s>R$ 4.199,00</s> por R$ 3.299,00")).not.toContain("4.199");
  });
  it("converte <br> em quebra de linha e decodifica entidades", () => {
    expect(htmlToText("a<br/>b &amp; c")).toBe("a\nb & c");
  });
});

describe("parsePrices", () => {
  it("pega preço colado no cifrão (padrão CT Ofertas)", () => {
    const r = parsePrices("A partir de R$3.149,10");
    expect(r.priceCents).toBe(314910);
  });

  it("pega preço com espaço depois do cifrão (padrão gt.OFERTAS)", () => {
    expect(parsePrices("Por R$ 4.475,00").priceCents).toBe(447500);
  });

  it("descarta parcela e fica com o preço à vista", () => {
    const r = parsePrices("por R$ 3.299,00 à vista ou 12x de R$ 274,91");
    expect(r.pricesCents).toEqual([329900]);
    expect(r.priceCents).toBe(329900);
  });

  it("descarta o preço riscado e devolve só o vigente", () => {
    const r = parsePrices("De <s>R$ 4.199,00</s> por R$ 3.299,00");
    expect(r.pricesCents).toEqual([329900]);
  });

  it("sem riscado, guarda os dois e usa o menor", () => {
    const r = parsePrices("De R$ 4.199,00 por R$ 3.299,00");
    expect(r.pricesCents).toEqual([329900, 419900]);
    expect(r.priceCents).toBe(329900);
  });

  it("devolve null quando não há preço", () => {
    const r = parsePrices("Siga o canal e ative as notificações!");
    expect(r.priceCents).toBeNull();
    expect(r.pricesCents).toEqual([]);
  });

  it("ignora valores irrisórios abaixo de R$1", () => {
    expect(parsePrices("cupom de R$ 0,50").priceCents).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/parse/price.test.ts`
Expected: FAIL — `Cannot find module '@/lib/parse/price'`

- [ ] **Step 3: Implementar**

`lib/parse/price.ts`:

```ts
const STRIKE_RE = /<(s|del|strike)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BR_RE = /<br\s*\/?>/gi;
const TAG_RE = /<[^>]+>/g;
const PRICE_RE = /R\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)/gi;
const INSTALLMENT_RE = /\d{1,2}\s*x\s*(?:de\s*)?$/i;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** HTML do post → texto puro, descartando o que estiver riscado (preço velho). */
export function htmlToText(html: string): string {
  const withoutStrike = html.replace(STRIKE_RE, " ");
  const withBreaks = withoutStrike.replace(BR_RE, "\n");
  const stripped = withBreaks.replace(TAG_RE, "");
  return stripped.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (m) => ENTITIES[m] ?? m);
}

/** "3.149,10" → 314910. Ponto é milhar, vírgula é decimal (formato BR). */
export function toCents(raw: string): number | null {
  const hasComma = raw.includes(",");
  const normalized = hasComma
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.replace(/\./g, "");
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/**
 * Extrai todos os preços válidos do post.
 * Descarta parcela ("12x de R$ 274,91") e preço riscado.
 * `priceCents` é o menor — o preço Pix, que é o que vale.
 */
export function parsePrices(html: string): {
  pricesCents: number[];
  priceCents: number | null;
} {
  const text = htmlToText(html);
  const found: number[] = [];

  for (const match of text.matchAll(PRICE_RE)) {
    const at = match.index ?? 0;
    const before = text.slice(Math.max(0, at - 12), at);
    if (INSTALLMENT_RE.test(before)) continue;

    const cents = toCents(match[1]);
    if (cents !== null && cents >= 100) found.push(cents);
  }

  const pricesCents = [...new Set(found)].sort((a, b) => a - b);
  return { pricesCents, priceCents: pricesCents[0] ?? null };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test tests/parse/price.test.ts`
Expected: PASS (12 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/parse/price.ts tests/parse/price.test.ts
git commit -m "feat(parse): extração de preço com descarte de parcela e riscado"
```

---

### Task 4: Detecção de loja

**Files:**
- Create: `lib/parse/store.ts`, `tests/parse/store.test.ts`

**Interfaces:**
- Consumes: `htmlToText` de `lib/parse/price.ts`
- Produces: `detectStore(html: string): { store: string | null; productUrl: string | null }`

- [ ] **Step 1: Escrever os testes que falham**

`tests/parse/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectStore } from "@/lib/parse/store";

describe("detectStore", () => {
  it("reconhece pelo domínio do encurtador da Amazon", () => {
    const r = detectStore("Oferta boa https://link.amazon/abc123 corre");
    expect(r.store).toBe("amazon");
    expect(r.productUrl).toBe("https://link.amazon/abc123");
  });

  it("reconhece shopee e aliexpress pelo domínio", () => {
    expect(detectStore("https://s.shopee.com.br/x").store).toBe("shopee");
    expect(detectStore("https://s.click.aliexpress.com/e/y").store).toBe("aliexpress");
  });

  it("reconhece mercado livre pelo encurtador meli.la", () => {
    expect(detectStore("https://meli.la/abc").store).toBe("mercadolivre");
  });

  it("cai no texto quando o domínio é encurtador do próprio canal", () => {
    const r = detectStore("Cupom no Magalu! Acesse: https://canalte.ch/c2p4/pbkbi");
    expect(r.store).toBe("magalu");
    expect(r.productUrl).toBe("https://canalte.ch/c2p4/pbkbi");
  });

  it("prefere o domínio sobre a menção no texto", () => {
    const r = detectStore("Igual ao da Shopee! https://link.amazon/abc");
    expect(r.store).toBe("amazon");
  });

  it("devolve null quando nada resolve", () => {
    const r = detectStore("Promoção imperdível https://canalte.ch/xyz");
    expect(r.store).toBeNull();
    expect(r.productUrl).toBe("https://canalte.ch/xyz");
  });

  it("devolve productUrl null quando não há link", () => {
    expect(detectStore("sem link aqui").productUrl).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/parse/store.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar**

`lib/parse/store.ts`:

```ts
import { htmlToText } from "@/lib/parse/price";

const URL_RE = /https?:\/\/[^\s<>"')]+/g;

const BY_DOMAIN: Array<[RegExp, string]> = [
  [/(^|\.)amazon\.|(^|\.)amzn\.to$|link\.amazon/i, "amazon"],
  [/aliexpress/i, "aliexpress"],
  [/shopee/i, "shopee"],
  [/mercadoliv|mercadolib|(^|\.)meli\.la$|(^|\.)mlb\.la$/i, "mercadolivre"],
  [/magazineluiza|magazinevoce|magalu/i, "magalu"],
  [/kabum/i, "kabum"],
  [/casasbahia/i, "casasbahia"],
  [/(^|\.)samsung\./i, "samsung"],
];

const BY_TEXT: Array<[RegExp, string]> = [
  [/\bamazon\b/i, "amazon"],
  [/\bali\s?express\b/i, "aliexpress"],
  [/\bshopee\b/i, "shopee"],
  [/\bmercado\s?livre\b/i, "mercadolivre"],
  [/\bmagalu\b|\bmagazine\s?luiza\b/i, "magalu"],
  [/\bkabum\b/i, "kabum"],
  [/\bcasas\s?bahia\b/i, "casasbahia"],
  [/\bsamsung\b/i, "samsung"],
];

/**
 * Loja do post, em duas fontes: domínio do link primeiro, menção no texto depois.
 * O fallback textual existe porque canais como o CT Ofertas encurtam TUDO pelo
 * domínio próprio (canalte.ch) — só o domínio perderia o canal inteiro.
 */
export function detectStore(html: string): {
  store: string | null;
  productUrl: string | null;
} {
  const text = htmlToText(html);
  const urls = text.match(URL_RE) ?? [];
  const productUrl = urls[0] ?? null;

  for (const url of urls) {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    for (const [re, store] of BY_DOMAIN) {
      if (re.test(host)) return { store, productUrl };
    }
  }

  for (const [re, store] of BY_TEXT) {
    if (re.test(text)) return { store, productUrl };
  }

  return { store: null, productUrl };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test tests/parse/store.test.ts`
Expected: PASS (7 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/parse/store.ts tests/parse/store.test.ts
git commit -m "feat(parse): detecção de loja por domínio com fallback textual"
```

---

### Task 5: Parser da página do canal

**Files:**
- Create: `lib/collector/parse.ts`, `tests/collector/parse.test.ts`, `tests/fixtures/ctofertascelulares.html`, `tests/fixtures/gtOFERTAS.html`, `tests/fixtures/vazio.html`

**Interfaces:**
- Consumes: `parsePrices` e `htmlToText` de `lib/parse/price.ts`, `detectStore` de `lib/parse/store.ts`
- Produces: `type ParsedPost = { postId: number; postedAt: string; text: string; url: string; priceCents: number | null; pricesCents: number[]; store: string | null; productUrl: string | null }`; `parseChannelPage(html: string, slug: string): ParsedPost[]`

- [ ] **Step 1: Baixar as fixtures reais**

```bash
mkdir -p tests/fixtures
curl -sL --max-time 25 -A "Mozilla/5.0" "https://t.me/s/ctofertascelulares" -o tests/fixtures/ctofertascelulares.html
curl -sL --max-time 25 -A "Mozilla/5.0" "https://t.me/s/gtOFERTAS" -o tests/fixtures/gtOFERTAS.html
printf '<html><body><div class="tgme_channel_history"></div></body></html>' > tests/fixtures/vazio.html
wc -c tests/fixtures/*.html
```

Expected: os dois arquivos reais com ~100KB ou mais; `vazio.html` com ~70 bytes.

- [ ] **Step 2: Escrever os testes que falham**

`tests/collector/parse.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseChannelPage } from "@/lib/collector/parse";

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, "../fixtures", name), "utf8");

describe("parseChannelPage", () => {
  it("extrai os posts da página do CT Ofertas", () => {
    const posts = parseChannelPage(fixture("ctofertascelulares.html"), "ctofertascelulares");
    expect(posts.length).toBeGreaterThanOrEqual(15);

    for (const p of posts) {
      expect(p.postId).toBeGreaterThan(0);
      expect(p.url).toBe(`https://t.me/ctofertascelulares/${p.postId}`);
      expect(new Date(p.postedAt).toString()).not.toBe("Invalid Date");
      expect(p.text.length).toBeGreaterThan(0);
    }
  });

  it("devolve os posts em ordem crescente de postId, sem repetir", () => {
    const posts = parseChannelPage(fixture("gtOFERTAS.html"), "gtOFERTAS");
    const ids = posts.map((p) => p.postId);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("preenche preço em pelo menos metade dos posts de um canal de ofertas", () => {
    const posts = parseChannelPage(fixture("gtOFERTAS.html"), "gtOFERTAS");
    const comPreco = posts.filter((p) => p.priceCents !== null);
    expect(comPreco.length).toBeGreaterThanOrEqual(Math.floor(posts.length / 2));
  });

  it("preenche loja mesmo no canal que só usa encurtador próprio", () => {
    const posts = parseChannelPage(fixture("ctofertascelulares.html"), "ctofertascelulares");
    expect(posts.some((p) => p.store !== null)).toBe(true);
  });

  it("devolve lista vazia para página sem mensagens", () => {
    expect(parseChannelPage(fixture("vazio.html"), "qualquer")).toEqual([]);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm test tests/collector/parse.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 4: Implementar**

`lib/collector/parse.ts`:

```ts
import { htmlToText, parsePrices } from "@/lib/parse/price";
import { detectStore } from "@/lib/parse/store";

export type ParsedPost = {
  postId: number;
  postedAt: string;
  text: string;
  url: string;
  priceCents: number | null;
  pricesCents: number[];
  store: string | null;
  productUrl: string | null;
};

const POST_ANCHOR_RE = /data-post="([^"/]+)\/(\d+)"/g;
const TEXT_RE = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/;
const TIME_RE = /<time[^>]*datetime="([^"]+)"/;

/**
 * HTML de t.me/s/<slug> → posts.
 *
 * A página não tem marcação aninhada confiável por mensagem, então fatiamos pelo
 * `data-post`, que é o único âncora estável: cada fatia vai de um âncora até o
 * próximo. Dentro da fatia, texto e horário saem por regex — o corpo da mensagem
 * só contém tags inline (a, b, i, br, s, code), nunca <div> aninhada.
 */
export function parseChannelPage(html: string, slug: string): ParsedPost[] {
  const anchors = [...html.matchAll(POST_ANCHOR_RE)].map((m) => ({
    index: m.index ?? 0,
    postId: Number(m[2]),
  }));

  const seen = new Set<number>();
  const posts: ParsedPost[] = [];

  for (let i = 0; i < anchors.length; i++) {
    const { index, postId } = anchors[i];
    if (seen.has(postId)) continue;

    const chunk = html.slice(index, anchors[i + 1]?.index ?? html.length);
    const textMatch = chunk.match(TEXT_RE);
    const timeMatch = chunk.match(TIME_RE);
    if (!textMatch || !timeMatch) continue;

    const rawHtml = textMatch[1];
    const text = htmlToText(rawHtml).trim();
    if (text.length === 0) continue;

    const { pricesCents, priceCents } = parsePrices(rawHtml);
    const { store, productUrl } = detectStore(rawHtml);

    seen.add(postId);
    posts.push({
      postId,
      postedAt: new Date(timeMatch[1]).toISOString(),
      text,
      url: `https://t.me/${slug}/${postId}`,
      priceCents,
      pricesCents,
      store,
      productUrl,
    });
  }

  return posts.sort((a, b) => a.postId - b.postId);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test tests/collector/parse.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 6: Commit**

```bash
git add lib/collector/parse.ts tests/collector/parse.test.ts tests/fixtures
git commit -m "feat(collector): parser da página do canal com fixtures reais"
```

---

### Task 6: Busca da página

**Files:**
- Create: `lib/collector/fetch.ts`, `tests/collector/fetch.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `fetchChannelPage(slug: string, before?: number, deps?: { fetchFn: typeof fetch }): Promise<string>`

- [ ] **Step 1: Escrever os testes que falham**

`tests/collector/fetch.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { channelPageUrl, fetchChannelPage } from "@/lib/collector/fetch";

describe("channelPageUrl", () => {
  it("monta a url do canal", () => {
    expect(channelPageUrl("gtOFERTAS")).toBe("https://t.me/s/gtOFERTAS");
  });
  it("acrescenta o cursor de paginação", () => {
    expect(channelPageUrl("gtOFERTAS", 147663)).toBe(
      "https://t.me/s/gtOFERTAS?before=147663",
    );
  });
});

describe("fetchChannelPage", () => {
  it("devolve o corpo quando a resposta é 200", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("<html>ok</html>", { status: 200 }));
    await expect(fetchChannelPage("x", undefined, { fetchFn })).resolves.toBe("<html>ok</html>");
  });

  it("lança erro identificando o canal quando a resposta não é 200", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    await expect(fetchChannelPage("sumido", undefined, { fetchFn })).rejects.toThrow(
      /sumido.*404/,
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/collector/fetch.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar**

`lib/collector/fetch.ts`:

```ts
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const TIMEOUT_MS = 15_000;

export function channelPageUrl(slug: string, before?: number): string {
  const base = `https://t.me/s/${slug}`;
  return before === undefined ? base : `${base}?before=${before}`;
}

export async function fetchChannelPage(
  slug: string,
  before?: number,
  deps: { fetchFn: typeof fetch } = { fetchFn: fetch },
): Promise<string> {
  const response = await deps.fetchFn(channelPageUrl(slug, before), {
    headers: { "user-agent": USER_AGENT, "accept-language": "pt-BR,pt;q=0.9" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Canal ${slug}: HTTP ${response.status}`);
  }
  return response.text();
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test tests/collector/fetch.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/collector/fetch.ts tests/collector/fetch.test.ts
git commit -m "feat(collector): busca da página com timeout e erro nomeado"
```

---

### Task 7: Gravação de posts e avanço de cursor

**Files:**
- Create: `lib/db/posts.ts`, `tests/db/posts.test.ts`

**Interfaces:**
- Consumes: `ParsedPost` de `lib/collector/parse.ts`, `PostRow` de `lib/db/types.ts`
- Produces: `toPostRows(posts: ParsedPost[], slug: string): PostRow[]`; `selectNewPosts(posts: ParsedPost[], lastPostId: number): ParsedPost[]`; `savePosts(db, slug, posts): Promise<number>`; `advanceCursor(db, slug, posts): Promise<void>`

- [ ] **Step 1: Escrever os testes que falham**

`tests/db/posts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ParsedPost } from "@/lib/collector/parse";
import { selectNewPosts, toPostRows } from "@/lib/db/posts";

const post = (postId: number, over: Partial<ParsedPost> = {}): ParsedPost => ({
  postId,
  postedAt: "2026-08-03T19:18:15.000Z",
  text: "Galaxy S25+ por R$ 3.099,00",
  url: `https://t.me/canal/${postId}`,
  priceCents: 309900,
  pricesCents: [309900],
  store: "amazon",
  productUrl: "https://link.amazon/x",
  ...over,
});

describe("selectNewPosts", () => {
  it("mantém só o que passou do cursor", () => {
    const r = selectNewPosts([post(10), post(11), post(12)], 11);
    expect(r.map((p) => p.postId)).toEqual([12]);
  });
  it("devolve tudo quando o cursor é zero", () => {
    expect(selectNewPosts([post(1), post(2)], 0)).toHaveLength(2);
  });
  it("devolve vazio quando nada é novo", () => {
    expect(selectNewPosts([post(1), post(2)], 99)).toEqual([]);
  });
});

describe("toPostRows", () => {
  it("mapeia para as colunas da tabela", () => {
    const [row] = toPostRows([post(7)], "gtOFERTAS");
    expect(row).toEqual({
      channel_slug: "gtOFERTAS",
      post_id: 7,
      posted_at: "2026-08-03T19:18:15.000Z",
      text: "Galaxy S25+ por R$ 3.099,00",
      url: "https://t.me/canal/7",
      price_cents: 309900,
      prices_cents: [309900],
      store: "amazon",
      product_url: "https://link.amazon/x",
    });
  });

  it("preserva null de preço e loja", () => {
    const [row] = toPostRows(
      [post(8, { priceCents: null, pricesCents: [], store: null, productUrl: null })],
      "x",
    );
    expect(row.price_cents).toBeNull();
    expect(row.prices_cents).toEqual([]);
    expect(row.store).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/db/posts.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar**

`lib/db/posts.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedPost } from "@/lib/collector/parse";
import type { PostRow } from "@/lib/db/types";

/** Posts além do cursor do canal. Puro. */
export function selectNewPosts(posts: ParsedPost[], lastPostId: number): ParsedPost[] {
  return posts.filter((p) => p.postId > lastPostId);
}

/** ParsedPost → linha da tabela. Puro. */
export function toPostRows(posts: ParsedPost[], slug: string): PostRow[] {
  return posts.map((p) => ({
    channel_slug: slug,
    post_id: p.postId,
    posted_at: p.postedAt,
    text: p.text,
    url: p.url,
    price_cents: p.priceCents,
    prices_cents: p.pricesCents,
    store: p.store,
    product_url: p.productUrl,
  }));
}

/**
 * Grava os posts. Idempotente: o unique (channel_slug, post_id) absorve
 * reprocessamento, então rodar o mesmo tick duas vezes não duplica nada.
 * Devolve quantas linhas foram enviadas.
 */
export async function savePosts(
  db: SupabaseClient,
  slug: string,
  posts: ParsedPost[],
): Promise<number> {
  if (posts.length === 0) return 0;
  const rows = toPostRows(posts, slug);
  const { error } = await db
    .from("posts")
    .upsert(rows, { onConflict: "channel_slug,post_id", ignoreDuplicates: true });
  if (error) throw new Error(`Gravando posts de ${slug}: ${error.message}`);
  return rows.length;
}

/** Move last_post_id para o maior id visto. Não retrocede. */
export async function advanceCursor(
  db: SupabaseClient,
  slug: string,
  posts: ParsedPost[],
): Promise<void> {
  if (posts.length === 0) return;
  const maxId = Math.max(...posts.map((p) => p.postId));
  const { error } = await db
    .from("channels")
    .update({ last_post_id: maxId })
    .eq("slug", slug)
    .lt("last_post_id", maxId);
  if (error) throw new Error(`Avançando cursor de ${slug}: ${error.message}`);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test tests/db/posts.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/db/posts.ts tests/db/posts.test.ts
git commit -m "feat(db): gravação idempotente de posts e avanço de cursor"
```

---

### Task 8: Rota de coleta (`/api/cron/tick`)

**Files:**
- Create: `lib/cron/auth.ts`, `lib/cron/ingest.ts`, `app/api/cron/tick/route.ts`, `tests/cron/auth.test.ts`, `tests/cron/ingest.test.ts`

**Interfaces:**
- Consumes: `fetchChannelPage`, `parseChannelPage`, `selectNewPosts`, `savePosts`, `advanceCursor`
- Produces: `assertCronAuth(req: Request, secret: string): void`; `type IngestReport = { slug: string; fetched: number; saved: number; error: string | null }`; `summarize(reports: IngestReport[]): { total: number; saved: number; failed: number; allEmpty: boolean }`

- [ ] **Step 1: Escrever os testes que falham**

`tests/cron/auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertCronAuth } from "@/lib/cron/auth";

const req = (headers: Record<string, string>) => new Request("https://x/", { headers });

describe("assertCronAuth", () => {
  it("aceita o header correto", () => {
    expect(() => assertCronAuth(req({ "x-cron-secret": "s3cr3t" }), "s3cr3t")).not.toThrow();
  });
  it("rejeita header ausente", () => {
    expect(() => assertCronAuth(req({}), "s3cr3t")).toThrow(/não autorizado/i);
  });
  it("rejeita header errado", () => {
    expect(() => assertCronAuth(req({ "x-cron-secret": "outro" }), "s3cr3t")).toThrow();
  });
});
```

`tests/cron/ingest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/cron/ingest";

describe("summarize", () => {
  it("soma o que foi buscado e gravado", () => {
    const r = summarize([
      { slug: "a", fetched: 20, saved: 3, error: null },
      { slug: "b", fetched: 20, saved: 0, error: null },
    ]);
    expect(r).toEqual({ total: 40, saved: 3, failed: 0, allEmpty: false });
  });

  it("conta canais que falharam", () => {
    const r = summarize([
      { slug: "a", fetched: 20, saved: 1, error: null },
      { slug: "b", fetched: 0, saved: 0, error: "HTTP 404" },
    ]);
    expect(r.failed).toBe(1);
  });

  it("acende o canário quando NENHUM canal devolveu post", () => {
    const r = summarize([
      { slug: "a", fetched: 0, saved: 0, error: null },
      { slug: "b", fetched: 0, saved: 0, error: null },
    ]);
    expect(r.allEmpty).toBe(true);
  });

  it("não acende o canário sem canais configurados", () => {
    expect(summarize([]).allEmpty).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/cron`
Expected: FAIL — módulos não existem

- [ ] **Step 3: Implementar auth e resumo**

`lib/cron/auth.ts`:

```ts
export function assertCronAuth(req: Request, secret: string): void {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || provided !== secret) {
    throw new Error("Não autorizado");
  }
}
```

`lib/cron/ingest.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseChannelPage } from "@/lib/collector/parse";
import { fetchChannelPage } from "@/lib/collector/fetch";
import { advanceCursor, savePosts, selectNewPosts } from "@/lib/db/posts";
import type { ChannelRow } from "@/lib/db/types";

export type IngestReport = {
  slug: string;
  fetched: number;
  saved: number;
  error: string | null;
};

/** Agrega os relatórios por canal. Puro. */
export function summarize(reports: IngestReport[]): {
  total: number;
  saved: number;
  failed: number;
  allEmpty: boolean;
} {
  const total = reports.reduce((n, r) => n + r.fetched, 0);
  const saved = reports.reduce((n, r) => n + r.saved, 0);
  const failed = reports.filter((r) => r.error !== null).length;
  return { total, saved, failed, allEmpty: reports.length > 0 && total === 0 };
}

async function ingestChannel(db: SupabaseClient, channel: ChannelRow): Promise<IngestReport> {
  try {
    const html = await fetchChannelPage(channel.slug);
    const parsed = parseChannelPage(html, channel.slug);
    const fresh = selectNewPosts(parsed, channel.last_post_id);
    const saved = await savePosts(db, channel.slug, fresh);
    await advanceCursor(db, channel.slug, parsed);
    return { slug: channel.slug, fetched: parsed.length, saved, error: null };
  } catch (e) {
    return {
      slug: channel.slug,
      fetched: 0,
      saved: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Coleta todos os canais ativos em paralelo. Um canal quebrado não derruba os outros. */
export async function ingestAll(db: SupabaseClient): Promise<IngestReport[]> {
  const { data, error } = await db.from("channels").select("*").eq("is_active", true);
  if (error) throw new Error(`Lendo canais: ${error.message}`);

  const channels = (data ?? []) as ChannelRow[];
  return Promise.all(channels.map((c) => ingestChannel(db, c)));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test tests/cron`
Expected: PASS (7 testes)

- [ ] **Step 5: Escrever a rota**

`app/api/cron/tick/route.ts`:

```ts
import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { ingestAll, summarize } from "@/lib/cron/ingest";
import { createDb } from "@/lib/db/client";
import { readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    assertCronAuth(req, readEnv().cronSecret);
  } catch {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const reports = await ingestAll(createDb());
  const summary = summarize(reports);

  // Canário: todo canal devolvendo zero post significa que o t.me mudou o HTML.
  // Falhar em silêncio aqui seria meses achando que não teve oferta.
  if (summary.allEmpty) {
    console.error("CANÁRIO: nenhum canal devolveu post", reports);
    return NextResponse.json({ ...summary, reports }, { status: 500 });
  }

  return NextResponse.json({ ...summary, reports });
}
```

- [ ] **Step 6: Verificar contra o Supabase real**

Insira um canal de teste e rode a coleta de verdade:

```bash
pnpm dev &
sleep 6
curl -s -X POST localhost:3010/api/cron/tick -H "x-cron-secret: $(grep CRON_SECRET .env.local | cut -d= -f2)" | head -40
```

Expected: 401 vira 200 com `{"total":0,...}` enquanto não houver canal cadastrado (a Task 10 popula). Um `curl` sem o header deve devolver 401.

- [ ] **Step 7: Commit**

```bash
git add lib/cron app/api/cron/tick tests/cron
git commit -m "feat(cron): rota de coleta com canário de HTML quebrado"
```

---

### Task 9: Rota de backfill

**Files:**
- Create: `lib/cron/backfill.ts`, `app/api/cron/backfill/route.ts`, `tests/cron/backfill.test.ts`

**Interfaces:**
- Consumes: `fetchChannelPage`, `parseChannelPage`, `savePosts`, `ChannelRow`
- Produces: `type BackfillDecision = { done: boolean; reason: string; nextCursor: number | null }`; `decideBackfill(posts: ParsedPost[], oldestAllowed: Date): BackfillDecision`

- [ ] **Step 1: Escrever os testes que falham**

`tests/cron/backfill.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ParsedPost } from "@/lib/collector/parse";
import { decideBackfill } from "@/lib/cron/backfill";

const LIMITE = new Date("2026-02-05T00:00:00Z");

const post = (postId: number, postedAt: string): ParsedPost => ({
  postId,
  postedAt,
  text: "t",
  url: "u",
  priceCents: null,
  pricesCents: [],
  store: null,
  productUrl: null,
});

describe("decideBackfill", () => {
  it("encerra quando a página vem vazia", () => {
    const d = decideBackfill([], LIMITE);
    expect(d.done).toBe(true);
    expect(d.reason).toMatch(/vazia/i);
  });

  it("encerra quando os posts passaram da janela", () => {
    const d = decideBackfill([post(5, "2025-11-01T00:00:00Z")], LIMITE);
    expect(d.done).toBe(true);
    expect(d.reason).toMatch(/janela/i);
  });

  it("continua e aponta o cursor para o menor postId", () => {
    const d = decideBackfill(
      [post(30, "2026-03-01T00:00:00Z"), post(28, "2026-03-01T00:00:00Z")],
      LIMITE,
    );
    expect(d.done).toBe(false);
    expect(d.nextCursor).toBe(28);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/cron/backfill.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar**

`lib/cron/backfill.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchChannelPage } from "@/lib/collector/fetch";
import { type ParsedPost, parseChannelPage } from "@/lib/collector/parse";
import { savePosts } from "@/lib/db/posts";
import type { ChannelRow } from "@/lib/db/types";

export const BACKFILL_MONTHS = 6;

export type BackfillDecision = {
  done: boolean;
  reason: string;
  nextCursor: number | null;
};

/** Decide se o backfill do canal acabou. Puro. */
export function decideBackfill(posts: ParsedPost[], oldestAllowed: Date): BackfillDecision {
  if (posts.length === 0) {
    return { done: true, reason: "página vazia", nextCursor: null };
  }
  const oldest = posts.reduce((a, b) => (a.postId <= b.postId ? a : b));
  if (new Date(oldest.postedAt) < oldestAllowed) {
    return { done: true, reason: "passou da janela", nextCursor: null };
  }
  return { done: false, reason: "continua", nextCursor: oldest.postId };
}

export function oldestAllowedFrom(now: Date, months = BACKFILL_MONTHS): Date {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d;
}

/**
 * Uma página por canal por invocação — lento de propósito, pra não martelar o t.me.
 * Canal já completo é no-op.
 */
export async function backfillOnce(db: SupabaseClient, now: Date): Promise<string[]> {
  const { data, error } = await db
    .from("channels")
    .select("*")
    .eq("is_active", true)
    .eq("backfill_complete", false);
  if (error) throw new Error(`Lendo canais: ${error.message}`);

  const limite = oldestAllowedFrom(now);
  const log: string[] = [];

  for (const channel of (data ?? []) as ChannelRow[]) {
    try {
      const cursor = channel.backfill_cursor ?? undefined;
      const html = await fetchChannelPage(channel.slug, cursor);
      const posts = parseChannelPage(html, channel.slug);
      await savePosts(db, channel.slug, posts);

      const decision = decideBackfill(posts, limite);
      await db
        .from("channels")
        .update(
          decision.done
            ? { backfill_complete: true }
            : { backfill_cursor: decision.nextCursor },
        )
        .eq("slug", channel.slug);

      log.push(`${channel.slug}: ${posts.length} posts, ${decision.reason}`);
    } catch (e) {
      log.push(`${channel.slug}: ERRO ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return log;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test tests/cron/backfill.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Escrever a rota**

`app/api/cron/backfill/route.ts`:

```ts
import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { backfillOnce } from "@/lib/cron/backfill";
import { createDb } from "@/lib/db/client";
import { readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    assertCronAuth(req, readEnv().cronSecret);
  } catch {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const log = await backfillOnce(createDb(), new Date());
  return NextResponse.json({ log });
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/cron/backfill.ts app/api/cron/backfill tests/cron/backfill.test.ts
git commit -m "feat(cron): backfill paginado com janela de 6 meses"
```

---

### Task 10: Seed dos canais, deploy e agendamento

**Files:**
- Create: `supabase/migrations/0002_seed_channels.sql`, `docs/OPERATIONS.md`

**Interfaces:**
- Consumes: tudo das tasks anteriores
- Produces: sistema rodando em produção

- [ ] **Step 1: Escrever o seed**

`supabase/migrations/0002_seed_channels.sql`:

```sql
insert into channels (slug, title, kind) values
  ('ctofertascelulares',            'CT Ofertas | Celulares',   'tech'),
  ('TudoPromo',                     'TudoPromo (TudoCelular)',  'tech'),
  ('jgtechofertas',                 'JG Ofertas',               'tech'),
  ('gtOFERTAS',                     'gt.OFERTAS',               'tech'),
  ('Chinacuponsbr',                 'China Cupons BR',          'china'),
  ('CuponsAliExpressChinaCuponsBR', 'Cupons AliExpress',        'china'),
  ('AliexpresspromocoesecuponsBR',  'AliExpress Promoções BR',  'china')
on conflict (slug) do nothing;
```

- [ ] **Step 2: Rodar o seed e a coleta local**

Cole `0002_seed_channels.sql` no SQL Editor do Supabase e rode. Depois:

```bash
pnpm dev &
sleep 6
curl -s -X POST localhost:3010/api/cron/tick -H "x-cron-secret: $(grep CRON_SECRET .env.local | cut -d= -f2)"
```

Expected: JSON com `"failed":0` e `total` em torno de 140 (7 canais × ~20 posts).

- [ ] **Step 3: Confirmar no banco que os dados estão bons**

No SQL Editor:

```sql
select channel_slug, count(*) as posts,
       count(price_cents) as com_preco,
       count(store) as com_loja
from posts group by 1 order by 1;
```

Expected: sete linhas; `com_preco` acima de metade em canais de oferta; `com_loja` maior que zero **inclusive** em `ctofertascelulares` (é o que prova o fallback textual).

- [ ] **Step 4: Rodar o backfill até completar**

```bash
for i in $(seq 1 20); do
  curl -s -X POST localhost:3010/api/cron/backfill \
    -H "x-cron-secret: $(grep CRON_SECRET .env.local | cut -d= -f2)" | head -3
  sleep 3
done
```

Expected: o log de cada canal caminha pra trás e, em algum momento, reporta `passou da janela` ou `página vazia`. Confirme com:

```sql
select slug, backfill_complete, backfill_cursor from channels order by slug;
select min(posted_at), max(posted_at), count(*) from posts;
```

**Anote a profundidade real do arquivo por canal** — o spec registra que isso é desconhecido até medir. Se algum canal parar muito raso (menos de 1 mês), registre no `docs/OPERATIONS.md`; é dado de entrada pra Etapa B.

- [ ] **Step 5: Deploy na Vercel**

```bash
gh repo create cacador-ofertas --private --source=. --push
```

Na Vercel: importar o repo, e em **Settings → Environment Variables** adicionar `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`. Deploy.

Expected: build verde; `curl -X POST https://<app>.vercel.app/api/cron/tick` sem header devolve 401.

- [ ] **Step 6: Agendar no cron-job.org**

Dois jobs, ambos **POST**, com header `x-cron-secret: <valor>`:

| URL | Frequência |
|---|---|
| `https://<app>.vercel.app/api/cron/tick` | a cada 5 min |
| `https://<app>.vercel.app/api/cron/backfill` | a cada 10 min |

- [ ] **Step 7: Escrever o runbook**

`docs/OPERATIONS.md` com: as variáveis de ambiente e onde pegar cada uma; a tabela dos dois jobs; como rodar migration (SQL Editor, ordem numérica); o que fazer quando o tick devolver 500 com `CANÁRIO` (o `t.me` mudou o HTML → rebaixar as fixtures em `tests/fixtures/` e corrigir `lib/collector/parse.ts`); e a profundidade de arquivo medida por canal no Step 4.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: seed dos canais, deploy e runbook de operação"
```

---

## Pronto quando

- `pnpm test` verde (45 testes).
- Sete canais coletando a cada 5 min em produção.
- `posts` com o histórico da janela de 6 meses, preço extraído na maioria e loja preenchida inclusive no canal que só usa encurtador próprio.
- Rodar o tick duas vezes seguidas não duplica linha nem retrocede cursor.
- `docs/OPERATIONS.md` com a profundidade real de arquivo medida por canal.

## Próxima etapa

Etapa B (busca histórica) ganha plano próprio depois que este rodar — as decisões de ranqueamento dependem de saber quantos posts por produto o arquivo realmente tem, que é exatamente o que o Step 4 da Task 10 mede.
