import { describe, expect, it } from "vitest";
import { decideReprocesso } from "@/lib/cron/reprocess";

describe("decideReprocesso", () => {
  it("mantém quando o preço novo é igual ao antigo", () => {
    const d = decideReprocesso(289900, {
      priceCents: 289900,
      pricesCents: [289900],
    });
    expect(d).toEqual({ action: "manter" });
  });

  it("mantém quando os dois são null", () => {
    const d = decideReprocesso(null, { priceCents: null, pricesCents: [] });
    expect(d).toEqual({ action: "manter" });
  });

  it("pula sem gravar quando o novo é null mas o antigo tinha preço", () => {
    const d = decideReprocesso(289900, { priceCents: null, pricesCents: [] });
    expect(d).toEqual({ action: "pular-perderia-preco" });
  });

  it("atualiza quando o preço muda de um valor pra outro", () => {
    const d = decideReprocesso(999900, {
      priceCents: 289900,
      pricesCents: [289900],
    });
    expect(d).toEqual({
      action: "atualizar",
      priceCents: 289900,
      pricesCents: [289900],
    });
  });

  it("atualiza quando o antigo era null e o novo achou preço", () => {
    const d = decideReprocesso(null, {
      priceCents: 289900,
      pricesCents: [289900],
    });
    expect(d).toEqual({
      action: "atualizar",
      priceCents: 289900,
      pricesCents: [289900],
    });
  });
});
