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
    expect(db._chain.limit).toHaveBeenCalledWith(2000);
  });

  // Este teste já assertou o contrário — que `buscar` pedia
  // `.order("price_cents", { ascending: true })` ao banco. A asserção estava
  // protegendo um defeito: com `order asc` + `limit(2000)`, um termo que casa
  // mais de 2000 posts fazia o banco devolver os 2000 MAIS BARATOS, e é sobre
  // esse conjunto que `priceStats` roda — a mediana virava a mediana da cauda
  // barata e `maxCents`, o 2000º mais barato em vez do maior preço real.
  // Como esses números alimentam o `/agora` e ancoram o preço-alvo do
  // `/cacar`, a ordenação foi tirada da consulta: o corte de 2000 passa a ser
  // uma amostra neutra do conjunto casado. Quem precisa de ordem é só
  // `melhores`, e essa ordenação acontece no cliente (ver os dois primeiros
  // testes deste arquivo, que continuam exigindo o resultado ordenado).
  it("NÃO pede ordenação ao banco — o limite tem que ser amostra neutra, não a cauda barata", async () => {
    const db = fakeDb([linha(300), linha(100), linha(200)]);
    const r = await buscar(db, "air fryer");
    expect(db._chain.order).not.toHaveBeenCalled();
    expect(db._chain.limit).toHaveBeenCalledWith(2000);
    // ordem do banco irrelevante: quem ordena é o cliente.
    expect(r.melhores.map((m) => m.priceCents)).toEqual([100, 200, 300]);
    expect(r.stats?.maxCents).toBe(300);
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
});
