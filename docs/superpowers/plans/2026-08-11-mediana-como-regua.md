# A mediana como régua — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a mediana ser a régua nos três lugares onde o usuário olha — o ranking da busca, o texto do alerta e a lista de caças — e permitir paginar todos os resultados do `/agora`.

**Architecture:** Uma função pura nova (`aplicarPiso`) filtra o que estiver absurdamente abaixo da mediana antes de escolher as melhores ofertas; a estatística passa a ser calculada sobre o conjunto já filtrado. O alerta e o `/cacas` consomem essa mesma estatística para dizer quanto a oferta está abaixo do que o mercado costuma cobrar. A paginação guarda a última busca em `bot_sessions` com um `flow` próprio, porque o `callback_data` do Telegram não comporta o termo.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Supabase Postgres, Vitest, Biome, pnpm. Telegram Bot API via `fetch`.

## Global Constraints

- **Dinheiro sempre em centavos (`integer`).** Nunca float, nunca reais.
- **Nada de `any`.** Biome trata como warning; não introduza nenhum.
- **Módulos puros não fazem I/O:** `lib/parse/*`, `lib/collector/parse.ts`, `lib/search/stats.ts`, `lib/bot/format.ts`, `lib/bot/flows/*`, `lib/hunts/*`, `lib/cron/reprocess.ts`, `lib/cron/purge.ts`. Sem `fetch`, sem cliente de banco.
- **Todo texto de usuário ou de post passa por `escapeHtml`** antes de entrar em mensagem HTML. Produto com `<` já travou o `/cacas` uma vez.
- **A rota de webhook responde 200 em todo caminho** exceto o 401 do secret errado. Erro que vira 500 faz o Telegram reenviar para sempre.
- **`callback_data` do Telegram é limitado a 64 bytes.**
- **Nenhum segredo em arquivo versionado.** Só nomes de variáveis.
- **Não rode `pnpm run check` sem argumento** — reformata o repositório inteiro. Use `pnpm exec biome check --write <caminhos>`.
- Node 20+, **pnpm**. Cliente Supabase é `service_role`, só no servidor.
- Design de referência: `docs/PLANO-MELHORIAS.md` (itens 1, 2 e 3).

## Interfaces que já existem (não reimplemente)

```ts
// lib/search/stats.ts
type PriceStats = { count: number; minCents: number; medianCents: number; maxCents: number };
priceStats(cents: number[]): PriceStats | null

// lib/search/query.ts
export const MESES_PADRAO = 3;            // janela da busca
type SearchHit = { text, priceCents, store, postedAt, url };
type SearchResult = { termo: string; stats: PriceStats | null; melhores: SearchHit[] };
buscar(db, termo, opts?: { meses?: number; limite?: number }): Promise<SearchResult>

// lib/bot/format.ts
formatBRL(cents: number): string;  formatSearch(r: SearchResult): string;  formatAjuda(): string
// lib/telegram.ts
escapeHtml(s), sendMessage(token, chatId, html, opts?), answerCallbackQuery(token, id), type InlineKeyboard
// lib/bot/session.ts
lerSessao(db, chatId), salvarSessao(db, chatId, step, data, agora), limparSessao(db, chatId)
// lib/bot/hunts-repo.ts
listarHunts(db, chatId): Promise<Array<{id,label,priceMinCents,priceMaxCents,isActive}>>
// lib/cron/alerts.ts
formatAlerta(hunt: Hunt, post: AlertPost): string
```

---

### Task 1: Piso relativo à mediana no ranking da busca

**Files:**
- Create: `tests/search/piso.test.ts`
- Modify: `lib/search/stats.ts`, `lib/search/query.ts`
- Modify: `tests/search/query.test.ts`

**Interfaces:**
- Produces: `PISO_FRACAO = 0.25`; `aplicarPiso<T extends { priceCents: number }>(itens: T[], medianaCents: number, fracao?: number): T[]`

**Por que 0.25, medido no arquivo real em 2026-08-11:**

| termo | sem piso (topo) | piso 25% (topo) | piso 40% |
|---|---|---|---|
| air fryer | R$10,30 forma de silicone ❌ | R$93 Air Fryer Britânia ✅ | R$117 — perdeu o de R$93 |
| mesa | R$8,79 decoração ❌ | R$69 | R$111 escrivaninha ✅ |
| fone bluetooth | R$16,99 (fone real) | R$35 fone real ✅ | R$54 — cortou 57 legítimos ❌ |
| galaxy s25 plus | R$3.519 ✅ | corta 0 | corta 0 |

25% mata o acessório escandaloso sem cortar produto barato legítimo. 40% já come earbud de verdade. Em termo bem-comportado não corta nada.

**Limite honesto:** o piso não resolve casamento semântico. Em `mesa`, "ventilador de mesa" continua no topo porque o preço dele é plausível. Isso é o problema de `includes` registrado em `docs/FOLLOW-UPS.md`, não de preço.

- [ ] **Step 1: Escrever os testes que falham**

`tests/search/piso.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PISO_FRACAO, aplicarPiso } from "@/lib/search/stats";

const item = (priceCents: number) => ({ priceCents });

describe("aplicarPiso", () => {
  it("corta o que está abaixo da fração da mediana", () => {
    // mediana 1000, piso 25% = 250
    const r = aplicarPiso([item(100), item(300), item(1000)], 1000);
    expect(r.map((i) => i.priceCents)).toEqual([300, 1000]);
  });

  it("mantém exatamente o valor do piso", () => {
    expect(aplicarPiso([item(250)], 1000).map((i) => i.priceCents)).toEqual([250]);
  });

  it("não corta nada quando todos estão acima", () => {
    expect(aplicarPiso([item(900), item(1100)], 1000)).toHaveLength(2);
  });

  it("aceita fração customizada", () => {
    expect(aplicarPiso([item(300), item(500)], 1000, 0.4).map((i) => i.priceCents)).toEqual([500]);
  });

  it("devolve lista vazia para entrada vazia", () => {
    expect(aplicarPiso([], 1000)).toEqual([]);
  });

  it("não altera o array recebido", () => {
    const entrada = [item(100), item(1000)];
    aplicarPiso(entrada, 1000);
    expect(entrada).toHaveLength(2);
  });

  it("PISO_FRACAO é 0.25", () => {
    expect(PISO_FRACAO).toBe(0.25);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/search/piso.test.ts`
Expected: FAIL — `aplicarPiso` não existe

- [ ] **Step 3: Implementar em `lib/search/stats.ts`**

Acrescente ao final do arquivo, sem alterar `priceStats`:

```ts
/**
 * Fração da mediana abaixo da qual um resultado é considerado acessório, não
 * o produto buscado. Medido contra o arquivo real em 2026-08-11: 0.25 corta a
 * forma de silicone de R$10 numa busca por "air fryer" (mediana R$290) mas
 * mantém o Air Fryer Britânia de R$93; 0.40 já descarta earbud legítimo de
 * R$54 numa busca por "fone bluetooth" (mediana R$136).
 *
 * Isto NÃO resolve casamento semântico — "ventilador de mesa" numa busca por
 * "mesa" tem preço plausível e continua passando. Ver `docs/FOLLOW-UPS.md`.
 */
export const PISO_FRACAO = 0.25;

/** Descarta itens absurdamente abaixo da mediana. Puro — não altera a entrada. */
export function aplicarPiso<T extends { priceCents: number }>(
  itens: T[],
  medianaCents: number,
  fracao: number = PISO_FRACAO,
): T[] {
  const piso = medianaCents * fracao;
  return itens.filter((i) => i.priceCents >= piso);
}
```

- [ ] **Step 4: Ligar em `buscar`, em duas passadas**

Em `lib/search/query.ts`, dentro de `buscar`, substitua o trecho que monta
`melhores` e `stats` por:

```ts
  const todos = linhas.map((l) => ({
    text: l.text,
    priceCents: l.price_cents,
    store: l.store,
    postedAt: l.posted_at,
    url: l.url,
  }));

  // Duas passadas de propósito: a mediana bruta define o piso, e a estatística
  // final é recalculada sobre o conjunto já filtrado. Sem a segunda passada, o
  // "menor preço" mostrado ao usuário continuaria sendo o acessório que o piso
  // acabou de descartar do ranking — a linha de estatística contradiria a lista.
  // O sort no cliente é obrigatório e tem teste próprio: a consulta NÃO pede
  // ordenação ao Postgres (isso enviesava a estatística, ver histórico de
  // `tests/search/query.test.ts`). Sem esta linha, `melhores` sai na ordem que
  // o banco devolveu e dois testes pré-existentes quebram.
  todos.sort((a, b) => a.priceCents - b.priceCents);

  const bruta = priceStats(todos.map((t) => t.priceCents));
  const filtrados = bruta ? aplicarPiso(todos, bruta.medianCents) : todos;
  const stats = priceStats(filtrados.map((t) => t.priceCents));

  return { termo, stats, melhores: filtrados.slice(0, limite) };
```

Acrescente `aplicarPiso` ao import de `@/lib/search/stats`.

- [ ] **Step 5: Acrescentar teste de integração em `tests/search/query.test.ts`**

Só acréscimo — não altere os testes existentes:

```ts
  it("descarta acessório muito abaixo da mediana e recalcula a estatística", async () => {
    // mediana bruta de [10, 900, 1000, 1100] é 950 → piso 237,50
    const db = fakeDb([linha(10), linha(900), linha(1000), linha(1100)]);
    const r = await buscar(db, "air fryer");
    expect(r.melhores.map((m) => m.priceCents)).toEqual([900, 1000, 1100]);
    expect(r.stats?.count).toBe(3);
    expect(r.stats?.minCents).toBe(900);
  });

  it("não descarta nada quando os preços são coerentes entre si", async () => {
    const db = fakeDb([linha(900), linha(1000), linha(1100)]);
    const r = await buscar(db, "galaxy s25");
    expect(r.stats?.count).toBe(3);
  });
```

- [ ] **Step 6: Rodar tudo e commitar**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm build`
Expected: os três passam

```bash
pnpm exec biome check --write lib/search/stats.ts lib/search/query.ts tests/search/piso.test.ts tests/search/query.test.ts
git add lib/search tests/search
git commit -m "feat(search): piso relativo a mediana tira acessorio do topo"
```

---

### Task 2: Alerta diz quanto está abaixo do mercado

**Files:**
- Modify: `lib/cron/alerts.ts`, `tests/cron/alerts.test.ts`

**Interfaces:**
- Consumes: `buscar` de `@/lib/search/query`, `PriceStats` de `@/lib/search/stats`
- Produces: `formatAlerta(hunt: Hunt, post: AlertPost, stats: PriceStats | null): string`

**Problema:** a mensagem diz *"12% abaixo do teto da sua faixa"*. O teto foi o usuário que escolheu, então o número não diz se a oferta é boa — só que está dentro do pedido. O que informa é *"18% abaixo da mediana dos últimos 3 meses"*.

**Decisão de custo, resolvida:** a mediana é calculada **uma vez por caça que tem alerta pendente**, não uma vez por alerta. Alertas são raros (zero até 2026-08-11) e o `tick` tem orçamento apertado (`ORCAMENTO_ENTREGA_MS = 35s`). Guardar a mediana na linha de `hunts` foi descartado: mais estado para sincronizar, e o ganho só apareceria com muitos alertas por tick.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente a `tests/cron/alerts.test.ts` — não altere os 4 existentes:

```ts
describe("formatAlerta com contexto de mercado", () => {
  const stats = { count: 91, minCents: 351900, medianCents: 396800, maxCents: 449900 };

  it("diz quanto está abaixo da mediana quando há estatística", () => {
    const s = formatAlerta(hunt, post, stats);
    // 289900 contra mediana 396800 → 27% abaixo
    expect(s).toMatch(/27%/);
    expect(s.toLowerCase()).toContain("mediana");
  });

  it("mantém a leitura da faixa do usuário", () => {
    expect(formatAlerta(hunt, post, stats).toLowerCase()).toContain("faixa");
  });

  it("omite a linha de mercado quando não há estatística", () => {
    const s = formatAlerta(hunt, post, null);
    expect(s.toLowerCase()).not.toContain("mediana");
    expect(s).toContain(formatBRL(post.priceCents));
  });

  it("não quebra quando o preço está acima da mediana", () => {
    const caro = { ...post, priceCents: 420000 };
    expect(() => formatAlerta(hunt, caro, stats)).not.toThrow();
  });
});
```

Acrescente `import { formatBRL } from "@/lib/bot/format";` se ainda não existir no arquivo.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/cron/alerts.test.ts`
Expected: FAIL — `formatAlerta` aceita 2 argumentos

- [ ] **Step 3: Implementar**

Em `lib/cron/alerts.ts`, troque a assinatura e o corpo de `formatAlerta`:

```ts
export function formatAlerta(
  hunt: Hunt,
  post: AlertPost,
  stats: PriceStats | null,
): string {
  const abaixoDaFaixa = Math.round((1 - post.priceCents / hunt.priceMaxCents) * 100);
  const loja = post.store ? ` · ${escapeHtml(post.store)}` : "";
  const quando = post.postedAt.slice(0, 10);
  const primeira =
    post.text
      .split("\n")
      .find((l) => l.trim().length > 0)
      ?.trim()
      .slice(0, 80) ?? "";

  const linhas = [
    `🎯 <b>${escapeHtml(hunt.label)}</b>`,
    `<b>${formatBRL(post.priceCents)}</b>${loja}`,
    `${abaixoDaFaixa}% abaixo do teto da sua faixa`,
  ];

  // A leitura que diz se a oferta é boa de verdade: o teto é escolha do
  // usuário, a mediana é o que o mercado cobra.
  if (stats) {
    const abaixoDoMercado = Math.round((1 - post.priceCents / stats.medianCents) * 100);
    linhas.push(
      `${abaixoDoMercado}% abaixo da mediana de ${MESES_PADRAO} meses (${formatBRL(stats.medianCents)})`,
    );
  }

  linhas.push(
    `postado em ${escapeHtml(quando)}`,
    `${escapeHtml(primeira)}`,
    `<a href="${escapeHtml(post.url)}">ver post</a>`,
  );
  return linhas.join("\n");
}
```

Acrescente aos imports: `import { MESES_PADRAO, buscar } from "@/lib/search/query";` e `import type { PriceStats } from "@/lib/search/stats";`

- [ ] **Step 4: Calcular a estatística uma vez por caça**

Em `processarAlertas`, antes do laço de entrega, monte um cache por `hunt_id`.
`hunts` tem a coluna `query` (texto original do produto) — inclua-a no `toHunt`
acrescentando `query: row.query as string` ao objeto e `query: string` ao tipo
`Hunt` em `lib/hunts/match.ts`.

**Consequência que vai quebrar a compilação, e é esperada:** acrescentar um
campo obrigatório a `Hunt` invalida todo literal de teste que monta um `Hunt`
sem ele — hoje em `tests/hunts/match.test.ts` e `tests/cron/alerts.test.ts`.
O `tsc` vai apontar cada um. Acrescente `query` a esses literais com um valor
coerente com o `label` (ex.: `query: "s25 plus"`), **sem alterar nenhuma
asserção** — o que esses testes verificam continua igual. Se preferir evitar
o efeito em cascata, declare `query` como opcional (`query?: string`) e trate
a ausência em `statsDaCaca` devolvendo `null`; decida e registre no relatório
qual caminho tomou e por quê.

No laço de entrega, antes de chamar `formatAlerta`, obtenha a estatística do
cache, calculando na primeira vez que aquela caça aparecer:

```ts
const statsPorHunt = new Map<string, PriceStats | null>();

async function statsDaCaca(db: SupabaseClient, hunt: Hunt): Promise<PriceStats | null> {
  const cache = statsPorHunt.get(hunt.id);
  if (cache !== undefined) return cache;
  try {
    const { stats } = await buscar(db, hunt.query);
    statsPorHunt.set(hunt.id, stats);
    return stats;
  } catch (e) {
    // Estatística é enfeite: se a busca falhar, o alerta sai sem a linha de
    // mercado em vez de não sair.
    console.error("Estatística da caça falhou:", e instanceof Error ? e.message : e);
    statsPorHunt.set(hunt.id, null);
    return null;
  }
}
```

Declare o `Map` **dentro** de `processarAlertas` (um por invocação, não global) e
passe `db` e o hunt para a função.

- [ ] **Step 5: Rodar tudo e commitar**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm build`

```bash
pnpm exec biome check --write lib/cron/alerts.ts lib/hunts/match.ts tests/cron/alerts.test.ts
git add lib/cron/alerts.ts lib/hunts/match.ts tests/cron/alerts.test.ts
git commit -m "feat(cron): alerta diz quanto esta abaixo da mediana do mercado"
```

---

### Task 3: Paginação do `/agora`

**Files:**
- Modify: `lib/telegram.ts`, `lib/bot/session.ts`, `lib/bot/format.ts`, `lib/bot/router.ts`
- Modify: `tests/bot/format.test.ts`, `tests/bot/router.test.ts`

**Interfaces:**
- Produces: `editMessageText(token, chatId, messageId, html, opts?)`; `FLOW_BUSCA = "busca"`; `formatSearchPagina(r: SearchResult, offset: number, porPagina: number): { texto: string; keyboard?: InlineKeyboard }`

**A armadilha que decide o desenho:** `callback_data` é limitado a **64 bytes**.
Não cabe o termo no botão — `mais:calça de academia masculina:5` é arriscado e
termo longo estoura sem erro visível. Então o botão carrega **só o offset**
(`pag:5`), e o termo vem da última busca guardada em `bot_sessions`.

**Conflito com o `/cacar`, resolvido:** o roteador hoje trata texto livre como
entrada de fluxo se existir sessão. Guardar busca na mesma tabela faria o bot
achar que o usuário está criando uma caça. Solução: a sessão de busca usa
`flow = "busca"`, e o roteador só entrega texto ao fluxo de caça quando
`flow === "new_hunt"`. Sessão de busca com texto livre = busca nova.

**Expiração:** `salvarSessao` usa 10 minutos, adequado para uma conversa em
andamento mas curto para voltar num resultado. A sessão de busca usa **60
minutos** — parametrize `salvarSessao` com um `expiraMin` opcional cujo padrão
continua 10, para não mexer no fluxo do `/cacar`.

**Tamanho da página:** 5 por página. O Telegram corta mensagem em ~4096
caracteres e cada oferta ocupa 2 linhas com link e título de até 70 caracteres —
5 cabe com folga, 10 fica no limite quando os títulos são longos.

**Editar, não empilhar:** a navegação usa `editMessageText` na mesma mensagem.
O chat fica limpo e o histórico não vira uma pilha de páginas.

- [ ] **Step 1: Escrever os testes de formatação que falham**

Acrescente a `tests/bot/format.test.ts`:

```ts
describe("formatSearchPagina", () => {
  const hit = (p: number) => ({
    text: `Produto ${p}`,
    priceCents: p,
    store: "amazon",
    postedAt: "2026-08-01T12:00:00Z",
    url: `https://t.me/x/${p}`,
  });
  const r = {
    termo: "air fryer",
    stats: { count: 12, minCents: 100, medianCents: 500, maxCents: 900 },
    melhores: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200].map(hit),
  };

  it("mostra só a fatia da página pedida", () => {
    const p = formatSearchPagina(r, 0, 5);
    expect(p.texto).toContain("Produto 100");
    expect(p.texto).not.toContain("Produto 600");
  });

  it("indica a posição na contagem total", () => {
    expect(formatSearchPagina(r, 5, 5).texto).toContain("6");
    expect(formatSearchPagina(r, 5, 5).texto).toContain("12");
  });

  it("na primeira página oferece só avançar", () => {
    const cbs = formatSearchPagina(r, 0, 5).keyboard?.inline_keyboard.flat().map((b) => b.callback_data) ?? [];
    expect(cbs).toContain("pag:5");
    expect(cbs.some((c) => c === "pag:-5")).toBe(false);
  });

  it("no meio oferece voltar e avançar", () => {
    const cbs = formatSearchPagina(r, 5, 5).keyboard?.inline_keyboard.flat().map((b) => b.callback_data) ?? [];
    expect(cbs).toContain("pag:0");
    expect(cbs).toContain("pag:10");
  });

  it("na última página não oferece avançar", () => {
    const cbs = formatSearchPagina(r, 10, 5).keyboard?.inline_keyboard.flat().map((b) => b.callback_data) ?? [];
    expect(cbs).toContain("pag:5");
    expect(cbs.some((c) => c === "pag:15")).toBe(false);
  });

  it("sem resultados não oferece botão nenhum", () => {
    const vazio = { termo: "xyz", stats: null, melhores: [] };
    expect(formatSearchPagina(vazio, 0, 5).keyboard).toBeUndefined();
  });

  it("todo callback_data cabe em 64 bytes", () => {
    for (const off of [0, 5, 10]) {
      for (const b of formatSearchPagina(r, off, 5).keyboard?.inline_keyboard.flat() ?? []) {
        expect(Buffer.byteLength(b.callback_data, "utf8")).toBeLessThanOrEqual(64);
      }
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/bot/format.test.ts`
Expected: FAIL — `formatSearchPagina` não existe

- [ ] **Step 3: Implementar `formatSearchPagina`**

Em `lib/bot/format.ts`, acrescente (mantendo `formatSearch`, que continua sendo
usado por quem não pagina):

```ts
export function formatSearchPagina(
  r: SearchResult,
  offset: number,
  porPagina: number,
): { texto: string; keyboard?: InlineKeyboard } {
  if (!r.stats || r.melhores.length === 0) {
    return { texto: formatSearch(r) };
  }

  const total = r.melhores.length;
  const fatia = r.melhores.slice(offset, offset + porPagina);

  const linhas = [
    `🔎 <b>${escapeHtml(r.termo)}</b> — ${r.stats.count} ofertas em ${MESES_PADRAO} meses`,
    `menor ${formatBRL(r.stats.minCents)} · mediana <b>${formatBRL(r.stats.medianCents)}</b> · maior ${formatBRL(r.stats.maxCents)}`,
    `<i>mostrando ${offset + 1}–${Math.min(offset + porPagina, total)} de ${total}</i>`,
    "",
  ];

  for (const m of fatia) {
    const loja = m.store ? ` · ${escapeHtml(m.store)}` : "";
    linhas.push(
      `<b>${formatBRL(m.priceCents)}</b>${loja} · ${m.postedAt.slice(0, 10)}`,
      `<a href="${escapeHtml(m.url)}">${escapeHtml(primeiraLinha(m.text))}</a>`,
      "",
    );
  }

  const botoes: Array<{ text: string; callback_data: string }> = [];
  if (offset > 0) {
    botoes.push({ text: "◀ anteriores", callback_data: `pag:${Math.max(0, offset - porPagina)}` });
  }
  if (offset + porPagina < total) {
    botoes.push({ text: "mais ofertas ▶", callback_data: `pag:${offset + porPagina}` });
  }

  return {
    texto: linhas.join("\n"),
    keyboard: botoes.length > 0 ? { inline_keyboard: [botoes] } : undefined,
  };
}
```

Acrescente `InlineKeyboard` ao import de `@/lib/telegram`.

- [ ] **Step 4: Acrescentar `editMessageText` ao cliente**

Em `lib/telegram.ts`:

```ts
export async function editMessageText(
  token: string,
  chatId: number,
  messageId: number,
  html: string,
  opts: { keyboard?: InlineKeyboard } = {},
): Promise<void> {
  await chamar(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(opts.keyboard ? { reply_markup: opts.keyboard } : {}),
  });
}
```

- [ ] **Step 5: Sessão de busca com expiração própria**

Em `lib/bot/session.ts`, acrescente o parâmetro opcional a `salvarSessao`
mantendo o padrão de 10 minutos, e exporte a constante do fluxo:

```ts
export const FLOW_BUSCA = "busca";
export const FLOW_CACA = "new_hunt";
```

Altere a assinatura para `salvarSessao(db, chatId, step, dados, agora, expiraMin = EXPIRA_MIN)`
e use `expiraMin` no cálculo de `expira`. Acrescente também `flow` como
parâmetro — hoje ele é gravado com `"new_hunt"` fixo. Nova assinatura:

```ts
salvarSessao(db, chatId, flow: string, step: Step, dados: FlowData, agora: Date, expiraMin?: number)
```

`lerSessao` passa a devolver `{ flow, step, data }`. Atualize as chamadas
existentes no roteador para passar `FLOW_CACA`.

- [ ] **Step 6: Ligar no roteador**

Em `lib/bot/router.ts`:

- No `/agora` (e no caminho de texto livre sem sessão), depois de buscar:
  guarde `flow: FLOW_BUSCA` com `data: { termo }` e expiração de 60 minutos,
  e envie `formatSearchPagina(r, 0, POR_PAGINA)` com o teclado.
- Trate o callback `pag:<offset>`: leia a sessão; se não houver ou não for
  `FLOW_BUSCA`, responda que a busca expirou e peça para repetir; senão refaça
  `buscar` com o termo guardado e **edite** a mensagem com a página pedida.
  O `messageId` vem de `callback_query.message.message_id` — estenda
  `extrairEntrada` para carregá-lo como campo opcional `messageId`.
- Na checagem de sessão para o fluxo de caça, exija `sessao.flow === FLOW_CACA`.

`POR_PAGINA = 5`, declarado como constante no roteador.

- [ ] **Step 7: Testes do roteador**

Acrescente a `tests/bot/router.test.ts` — só acréscimo:

```ts
  it("extrai o messageId do callback, necessário para editar a mensagem", () => {
    const r = extrairEntrada({
      callback_query: { id: "cb", data: "pag:5", message: { message_id: 42, chat: { id: 7 } } },
    });
    expect(r?.messageId).toBe(42);
  });

  it("mensagem comum não traz messageId de edição", () => {
    expect(extrairEntrada({ message: { chat: { id: 7 }, text: "oi" } })?.messageId).toBeUndefined();
  });
```

- [ ] **Step 8: Rodar tudo e commitar**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm build`

```bash
pnpm exec biome check --write lib/telegram.ts lib/bot/session.ts lib/bot/format.ts lib/bot/router.ts tests/bot/format.test.ts tests/bot/router.test.ts
git add lib/telegram.ts lib/bot tests/bot
git commit -m "feat(bot): paginacao do /agora com botao de ver mais"
```

---

### Task 4: `/cacas` mostra quão longe o mercado está

**Files:**
- Modify: `lib/bot/hunts-repo.ts`, `lib/bot/format.ts`, `lib/bot/router.ts`
- Modify: `tests/bot/hunts-repo.test.ts`, `tests/bot/format.test.ts`

**Interfaces:**
- `listarHunts` passa a devolver também `query: string`
- Produces: `formatCacas(itens: Array<{ label: string; priceMinCents: number; priceMaxCents: number; melhorAtualCents: number | null; medianaCents: number | null }>): string`

**Problema:** o `/cacas` mostra a faixa que o usuário pediu, mas não mostra
quanto o mercado está longe dela. Caça que não dispara há semanas é
indistinguível de caça quebrada. Com as 6 caças atuais, os alvos estão 2–7%
abaixo do mínimo histórico — informação que o usuário não tem como ver.

- [ ] **Step 1: Escrever os testes que falham**

`tests/bot/format.test.ts`:

```ts
describe("formatCacas", () => {
  const base = {
    label: "Galaxy S25 Plus",
    priceMinCents: 270000,
    priceMaxCents: 330000,
    melhorAtualCents: 351912,
    medianaCents: 396800,
  };

  it("mostra a faixa pedida", () => {
    const s = formatCacas([base]);
    expect(s).toContain(formatBRL(270000));
    expect(s).toContain(formatBRL(330000));
  });

  it("mostra o melhor preço atual e quanto falta cair", () => {
    const s = formatCacas([base]);
    expect(s).toContain(formatBRL(351912));
    // 351912 contra teto 330000 → 7% acima
    expect(s).toMatch(/7%/);
  });

  it("avisa quando já está dentro da faixa", () => {
    const s = formatCacas([{ ...base, melhorAtualCents: 320000 }]);
    expect(s.toLowerCase()).toContain("dentro da faixa");
  });

  it("lida com caça sem nenhuma oferta conhecida", () => {
    const s = formatCacas([{ ...base, melhorAtualCents: null, medianaCents: null }]);
    expect(s.toLowerCase()).toContain("nenhuma oferta");
  });

  it("escapa o rótulo do usuário", () => {
    const s = formatCacas([{ ...base, label: "tv <50 & cia" }]);
    expect(s).toContain("&lt;50");
    expect(s).not.toContain("<50 &");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test tests/bot/format.test.ts`
Expected: FAIL — `formatCacas` não existe

- [ ] **Step 3: Implementar `formatCacas`**

Em `lib/bot/format.ts`:

```ts
export type CacaResumo = {
  label: string;
  priceMinCents: number;
  priceMaxCents: number;
  melhorAtualCents: number | null;
  medianaCents: number | null;
};

export function formatCacas(itens: CacaResumo[]): string {
  const blocos = itens.map((c) => {
    const linhas = [
      `🎯 <b>${escapeHtml(c.label)}</b>`,
      `   sua faixa: ${formatBRL(c.priceMinCents)} a ${formatBRL(c.priceMaxCents)}`,
    ];
    if (c.melhorAtualCents === null) {
      linhas.push("   <i>nenhuma oferta encontrada ainda</i>");
    } else if (c.melhorAtualCents <= c.priceMaxCents) {
      linhas.push(`   melhor agora: ${formatBRL(c.melhorAtualCents)} — <b>dentro da faixa</b>`);
    } else {
      const acima = Math.round((c.melhorAtualCents / c.priceMaxCents - 1) * 100);
      linhas.push(`   melhor agora: ${formatBRL(c.melhorAtualCents)} — ${acima}% acima do seu teto`);
    }
    if (c.medianaCents !== null) {
      linhas.push(`   mediana ${MESES_PADRAO} meses: ${formatBRL(c.medianaCents)}`);
    }
    return linhas.join("\n");
  });
  return blocos.join("\n\n");
}
```

- [ ] **Step 4: `listarHunts` devolve `query`**

Em `lib/bot/hunts-repo.ts`, acrescente `query` ao `select`, ao tipo de retorno e
ao mapeamento. Atualize `tests/bot/hunts-repo.test.ts` para conferir que o
`select` pede a coluna — só acréscimo de asserção, sem enfraquecer as existentes.

- [ ] **Step 5: Ligar no `/cacas`**

Em `lib/bot/router.ts`, no bloco do `/cacas`, para cada caça ativa chame
`buscar(db, h.query, { limite: 1 })` e monte o `CacaResumo` com
`melhorAtualCents = r.melhores[0]?.priceCents ?? null` e
`medianaCents = r.stats?.medianCents ?? null`. Envie `formatCacas(...)` com o
mesmo teclado de exclusão que já existe.

São até 6 consultas num comando sob demanda — aceitável, e não roda dentro do
`tick`. Se uma busca falhar, use `null` nos dois campos em vez de derrubar o
comando inteiro.

- [ ] **Step 6: Rodar tudo e commitar**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm build`

```bash
pnpm exec biome check --write lib/bot/hunts-repo.ts lib/bot/format.ts lib/bot/router.ts tests/bot
git add lib/bot tests/bot
git commit -m "feat(bot): /cacas mostra melhor preco atual e distancia da faixa"
```

---

### Task 5: Publicar e conferir no Telegram

**Files:**
- Modify: `docs/OPERATIONS.md`

- [ ] **Step 1: Verificar a suíte inteira**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm build`
Expected: os três passam. A suíte tinha 191 testes antes desta rodada.

- [ ] **Step 2: Publicar**

```bash
git push origin main
```

Aguarde o deploy da Vercel e confirme que as rotas continuam de pé:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://vai-gerar.vercel.app/api/telegram/webhook
```

Expected: `401` (sem o segredo, é o comportamento correto)

- [ ] **Step 3: Conferir no chat, com o bot de verdade**

Mande ao `@Vaigerarviubot`, na ordem:

1. `/agora air fryer` — o primeiro resultado **não** pode ser forma de silicone
   nem acessório; deve aparecer o rodapé "mostrando 1–5 de N" e o botão
   "mais ofertas ▶"
2. Clique em "mais ofertas ▶" — a **mesma mensagem** deve mudar para 6–10, com
   os dois botões
3. `/cacas` — cada caça deve mostrar "melhor agora" e quantos % acima do teto
4. `/agora galaxy s25 plus` — confira que a mediana bate com ~R$3.968

- [ ] **Step 4: Atualizar o runbook e commitar**

Em `docs/OPERATIONS.md`, acrescente à seção do bot: que o `/agora` pagina e que
a navegação depende de uma sessão de 60 minutos (clicar num resultado de mais
de uma hora atrás pede busca nova), e que o piso de 25% da mediana descarta
resultado absurdamente barato — com o número medido e a data, para ninguém
mexer sem saber de onde veio.

```bash
git add docs/OPERATIONS.md
git commit -m "docs(ops): paginacao do /agora e piso da mediana"
git push origin main
```

---

## Pronto quando

- `pnpm test`, `pnpm exec tsc --noEmit` e `pnpm build` passam.
- `/agora air fryer` não traz acessório no topo.
- O botão "mais ofertas" edita a mesma mensagem e navega para frente e para trás.
- `/cacas` mostra, para cada caça, o melhor preço atual e a distância do teto.
- Um alerta (real ou forçado em teste) traz a linha de quanto está abaixo da mediana.

## Fora de escopo

- **Tendência de preço** (item 4 de `docs/PLANO-MELHORIAS.md`) — cria capacidade
  nova, merece rodada própria.
- **Segundo bot** e **resumo diário** (itens 5 e 6) — idem.
- **Casamento semântico.** O piso resolve preço absurdo, não "ventilador de mesa"
  numa busca por "mesa". Continua registrado em `docs/FOLLOW-UPS.md`.
