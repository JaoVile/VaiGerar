import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParsedPost } from "@/lib/collector/parse";
import { backfillOnce, decideBackfill, summarizeBackfill } from "@/lib/cron/backfill";
import { channel, createFakeDb, fakeFetch } from "../helpers/fake-db";

const LIMITE = new Date("2026-02-05T00:00:00Z");

/** Dentro da janela de 6 meses contada a partir daqui (fixtures são de agosto). */
const AGORA = new Date("2026-08-05T23:00:00Z");

const fixture = (name: string) => readFileSync(resolve(__dirname, "../fixtures", name), "utf8");

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

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("encerra com cursor travado quando o cursor não avança", () => {
    const d = decideBackfill(
      [post(30, "2026-03-01T00:00:00Z"), post(28, "2026-03-01T00:00:00Z")],
      LIMITE,
      28,
    );
    expect(d.done).toBe(true);
    expect(d.reason).toMatch(/cursor.*travado/i);
  });

  it("NÃO conclui quando havia âncoras na página e nenhum post foi extraído", () => {
    const d = decideBackfill([], LIMITE, 500, 20);
    expect(d.done).toBe(false);
    expect(d.broken).toBe(true);
    expect(d.reason).toMatch(/parser quebrado/i);
    expect(d.nextCursor).toBeNull();
  });

  it("continua concluindo quando a página não tem âncora nenhuma", () => {
    const d = decideBackfill([], LIMITE, 500, 0);
    expect(d.done).toBe(true);
    expect(d.broken).toBe(false);
    expect(d.reason).toMatch(/vazia/i);
  });

  it("na primeira execução (sem cursor anterior) não conclui prematuramente", () => {
    const d = decideBackfill(
      [post(30, "2026-03-01T00:00:00Z"), post(28, "2026-03-01T00:00:00Z")],
      LIMITE,
      undefined,
      20,
    );
    expect(d.done).toBe(false);
    expect(d.broken).toBe(false);
    expect(d.nextCursor).toBe(28);
  });
});

describe("summarizeBackfill", () => {
  it("conta ok, falha e quebra", () => {
    const s = summarizeBackfill([
      { slug: "a", posts: 20, reason: "continua", broken: false, error: null },
      { slug: "b", posts: 0, reason: "erro", broken: false, error: "HTTP 404" },
      {
        slug: "c",
        posts: 0,
        reason: "parser quebrado",
        broken: true,
        error: null,
      },
    ]);
    expect(s).toMatchObject({
      channels: 3,
      posts: 20,
      ok: 1,
      failed: 1,
      broken: 1,
      noneOk: false,
    });
    expect(s.log).toEqual([
      "a: 20 posts, continua",
      "b: ERRO HTTP 404",
      "c: 0 posts, parser quebrado",
    ]);
  });

  it("acende noneOk quando nenhum canal processado deu certo", () => {
    const s = summarizeBackfill([
      { slug: "a", posts: 0, reason: "erro", broken: false, error: "timeout" },
      { slug: "b", posts: 0, reason: "erro", broken: false, error: "timeout" },
    ]);
    expect(s.noneOk).toBe(true);
  });

  it("não acende noneOk sem canais a processar (todos já completos)", () => {
    expect(summarizeBackfill([]).noneOk).toBe(false);
  });
});

describe("backfillOnce", () => {
  it("avança o cursor para o menor postId da página", async () => {
    vi.stubGlobal("fetch", fakeFetch({ gtOFERTAS: fixture("gtOFERTAS.html") }));
    const db = createFakeDb([channel({ slug: "gtOFERTAS" })]);

    const reports = await backfillOnce(db.client, AGORA);

    expect(reports).toEqual([
      {
        slug: "gtOFERTAS",
        posts: 20,
        reason: "continua",
        broken: false,
        error: null,
      },
    ]);
    expect(db.updates).toEqual([
      {
        table: "channels",
        patch: { backfill_cursor: 173684 },
        filters: { slug: "gtOFERTAS" },
      },
    ]);
  });

  it("marca completo quando a página não tem âncora nenhuma", async () => {
    vi.stubGlobal("fetch", fakeFetch({ velho: fixture("vazio.html") }));
    const db = createFakeDb([channel({ slug: "velho", backfill_cursor: 42 })]);

    const reports = await backfillOnce(db.client, AGORA);

    expect(reports[0].reason).toMatch(/vazia/i);
    expect(db.updates).toEqual([
      {
        table: "channels",
        patch: { backfill_complete: true },
        filters: { slug: "velho" },
      },
    ]);
  });

  it("NÃO marca completo nem mexe no cursor quando o parser quebra", async () => {
    vi.stubGlobal("fetch", fakeFetch({ quebrado: fixture("quebrado.html") }));
    const db = createFakeDb([channel({ slug: "quebrado", backfill_cursor: 1001 })]);

    const reports = await backfillOnce(db.client, AGORA);

    expect(reports[0]).toMatchObject({
      slug: "quebrado",
      posts: 0,
      broken: true,
      error: null,
    });
    expect(reports[0].reason).toMatch(/parser quebrado/i);
    // O ponto todo do achado: nenhuma escrita em `channels`.
    expect(db.updates).toEqual([]);
    expect(summarizeBackfill(reports).broken).toBe(1);
  });

  it("isola o canal que falhou e segue com os outros", async () => {
    vi.stubGlobal("fetch", fakeFetch({ gtOFERTAS: fixture("gtOFERTAS.html") }));
    const db = createFakeDb([channel({ slug: "sumiu" }), channel({ slug: "gtOFERTAS" })]);

    const reports = await backfillOnce(db.client, AGORA);

    expect(reports[0].error).toMatch(/404/);
    expect(reports[1].error).toBeNull();
    const s = summarizeBackfill(reports);
    expect(s.failed).toBe(1);
    expect(s.ok).toBe(1);
    expect(s.noneOk).toBe(false);
  });

  it("não avança o cursor quando a gravação dos posts falha", async () => {
    vi.stubGlobal("fetch", fakeFetch({ gtOFERTAS: fixture("gtOFERTAS.html") }));
    const db = createFakeDb([channel({ slug: "gtOFERTAS" })], {
      upsertError: "value out of range for type integer",
    });

    const reports = await backfillOnce(db.client, AGORA);

    expect(reports[0].error).toMatch(/out of range/);
    expect(db.updates).toEqual([]);
  });

  it("propaga erro de leitura da tabela channels (a rota converte em 500)", async () => {
    const db = createFakeDb([], { selectError: "connection refused" });
    await expect(backfillOnce(db.client, AGORA)).rejects.toThrow(/Lendo canais/);
  });
});
