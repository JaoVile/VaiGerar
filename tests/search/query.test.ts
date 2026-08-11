import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { buscar } from "@/lib/search/query";

function fakeDb(linhas: unknown[]) {
  const chain = {
    select: vi.fn(() => chain),
    textSearch: vi.fn(() => chain),
    not: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve({ data: linhas, error: null })),
  };
  return {
    from: vi.fn(() => chain),
    _chain: chain,
  } as unknown as SupabaseClient & {
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
    expect(r.stats).toEqual({
      count: 3,
      minCents: 100,
      medianCents: 200,
      maxCents: 300,
    });
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
    expect(db._chain.textSearch).toHaveBeenCalledWith("search_vector", "calça academia", {
      type: "plain",
      config: "portuguese",
    });
    expect(db._chain.order).toHaveBeenCalledWith("price_cents", {
      ascending: true,
    });
    expect(db._chain.limit).toHaveBeenCalledWith(2000);
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
