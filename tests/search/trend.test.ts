import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { formatTendencia } from "@/lib/bot/format";
import { dispersaoDe, tendencia } from "@/lib/search/trend";

function fakeDb(linhas: unknown[]) {
  const chain = {
    select: vi.fn(() => chain),
    textSearch: vi.fn(() => chain),
    not: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve({ data: linhas, error: null })),
  };
  return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
}

/**
 * Gera `n` anúncios de um mês com preços em torno de `centro`.
 *
 * O `texto` é parâmetro porque `tendencia` passa tudo por `casaTermo`: usar um
 * texto que não casa o termo faz a série chegar vazia, e o teste passa a medir
 * "sem-dado" em vez do que queria medir. Aconteceu na primeira versão destes
 * testes.
 */
function mes(
  mesIso: string,
  n: number,
  centro: number,
  texto = "Samsung Galaxy S25 Plus 256GB",
  espalha = 0,
) {
  return Array.from({ length: n }, (_, i) => ({
    text: texto,
    price_cents: centro + (i % 3) * espalha,
    posted_at: `${mesIso}-10T12:00:00Z`,
  }));
}

describe("dispersaoDe", () => {
  // Medido no arquivo real em 12/08. A separação é de mais de dez vezes, por
  // isso o limite de 0,25 no meio não é escolhido a dedo.
  //   galaxy s25 plus 0,02   galaxy s25 0,04   <- produto único
  //   notebook        0,42   air fryer  0,65   fone bluetooth 0,93  <- categoria
  it("preço concentrado dá dispersão baixa", () => {
    const d = dispersaoDe([399900, 401000, 398000, 400500, 399000]);
    expect(d).toBeLessThan(0.25);
  });

  it("preço espalhado dá dispersão alta", () => {
    const d = dispersaoDe([5000, 19000, 31000, 45000, 90000]);
    expect(d).toBeGreaterThan(0.25);
  });

  it("amostra de um item não tem dispersão", () => {
    expect(dispersaoDe([1000])).toBeNull();
  });
});

describe("tendencia", () => {
  it("produto único com 3+ meses devolve a série e a variação", async () => {
    const db = fakeDb([
      ...mes("2026-06", 6, 417400),
      ...mes("2026-07", 6, 399900),
      ...mes("2026-08", 6, 379900),
    ]);
    const t = await tendencia(db, "galaxy s25 plus");

    expect(t.calculavel).toBe(true);
    expect(t.meses.map((m) => m.mes)).toEqual(["2026-06", "2026-07", "2026-08"]);
    // 417400 -> 379900 é -9%
    expect(Math.round(t.variacaoPct ?? 0)).toBe(-9);
    expect(Math.round(t.variacaoPctMes ?? 0)).toBe(-4);
  });

  // O caso que motivou o módulo. Para "air fryer" a conta ingênua diria
  // "subiu 91% desde maio" — mas o que mudou foi o mix de anúncios, não o
  // preço. Recusar é a resposta certa.
  it("categoria recusa em vez de desenhar reta falsa", async () => {
    const db = fakeDb([
      ...mes("2026-06", 6, 19000, "Air Fryer Mondial 3L", 12000),
      ...mes("2026-07", 6, 31400, "Air Fryer Philco 8L", 12000),
      ...mes("2026-08", 6, 36300, "Air Fryer Britania 12L", 12000),
    ]);
    const t = await tendencia(db, "air fryer");

    expect(t.calculavel).toBe(false);
    expect(t.motivo).toBe("categoria");
    expect(t.variacaoPct).toBeNull();
  });

  it("menos de 3 meses não vira tendência", async () => {
    const db = fakeDb([...mes("2026-07", 6, 399900), ...mes("2026-08", 6, 379900)]);
    const t = await tendencia(db, "galaxy s25 plus");

    expect(t.calculavel).toBe(false);
    expect(t.motivo).toBe("poucos-meses");
  });

  // Dobrável tem 2 anúncios em 3 meses. Um mês com 2 pontos não é ponto de
  // gráfico — vira mediana de duas leituras e mexe a reta inteira.
  it("mês com amostra ralinha não vira ponto do gráfico", async () => {
    const db = fakeDb([
      ...mes("2026-06", 6, 399900),
      ...mes("2026-07", 2, 300000),
      ...mes("2026-08", 6, 379900),
    ]);
    const t = await tendencia(db, "galaxy s25 plus");

    expect(t.meses.map((m) => m.mes)).toEqual(["2026-06", "2026-08"]);
  });

  it("termo sem nenhum anúncio não lança", async () => {
    const t = await tendencia(fakeDb([]), "produto que nao existe");
    expect(t.calculavel).toBe(false);
    expect(t.motivo).toBe("sem-dado");
  });

  // Mesmo recorte do ranking da busca: sem ele a série de "galaxy s25" carrega
  // preço de S25 Ultra e a tendência vira composição outra vez.
  it("ignora o modelo superior na série", async () => {
    const db = fakeDb([
      ...mes("2026-06", 6, 344400, "Samsung Galaxy S25 5G 256GB"),
      ...mes("2026-07", 6, 329700, "Samsung Galaxy S25 5G 256GB"),
      ...mes("2026-08", 6, 344700, "Samsung Galaxy S25 5G 256GB"),
      ...Array.from({ length: 20 }, () => ({
        text: "Samsung Galaxy S25 Ultra 512GB",
        price_cents: 900000,
        posted_at: "2026-08-10T12:00:00Z",
      })),
    ]);
    const t = await tendencia(db, "galaxy s25");

    expect(t.calculavel).toBe(true);
    expect(t.meses.every((m) => m.medianCents < 400000)).toBe(true);
  });
});

describe("formatTendencia", () => {
  const base = {
    termo: "galaxy s25 plus",
    meses: [
      { mes: "2026-06", medianCents: 417400, n: 20 },
      { mes: "2026-07", medianCents: 399900, n: 29 },
      { mes: "2026-08", medianCents: 379900, n: 14 },
    ],
    dispersao: 0.02,
  };

  it("desenha uma barra por mês e diz o ritmo da queda", () => {
    const s = formatTendencia({
      ...base,
      calculavel: true,
      motivo: null,
      variacaoPct: -9,
      variacaoPctMes: -4.5,
    });
    expect(s).toContain("jun");
    expect(s).toContain("ago");
    expect(s).toContain("▇");
    expect(s.toLowerCase()).toContain("caindo");
  });

  it("preço subindo não é descrito como queda", () => {
    const s = formatTendencia({
      ...base,
      calculavel: true,
      motivo: null,
      variacaoPct: 8,
      variacaoPctMes: 4,
    });
    expect(s.toLowerCase()).toContain("subindo");
    expect(s.toLowerCase()).not.toContain("caindo");
  });

  it("categoria explica por que não dá, em vez de só negar", () => {
    const s = formatTendencia({
      ...base,
      meses: [],
      calculavel: false,
      motivo: "categoria",
      variacaoPct: null,
      variacaoPctMes: null,
    });
    expect(s.toLowerCase()).toContain("mix");
    expect(s).toContain("/tendencia");
  });

  it("poucos meses diz que falta histórico, não que não existe", () => {
    const s = formatTendencia({
      ...base,
      meses: base.meses.slice(0, 1),
      calculavel: false,
      motivo: "poucos-meses",
      variacaoPct: null,
      variacaoPctMes: null,
    });
    expect(s.toLowerCase()).toContain("histórico");
  });
});
