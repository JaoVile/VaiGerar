import { describe, expect, it } from "vitest";
import { aplicarPiso, PISO_FRACAO } from "@/lib/search/stats";

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
