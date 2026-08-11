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
