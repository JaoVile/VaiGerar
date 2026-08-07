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
