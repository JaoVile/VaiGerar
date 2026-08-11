import { describe, expect, it } from "vitest";
import { iniciar, receber } from "@/lib/bot/flows/new-hunt";

const STATS = {
  count: 23,
  minCents: 279900,
  medianCents: 315000,
  maxCents: 420000,
};

describe("fluxo de nova caça", () => {
  it("começa perguntando o produto", () => {
    const r = iniciar();
    expect(r.proximo).toBe("ask_product");
    expect(r.texto.toLowerCase()).toContain("produto");
  });

  it("depois do produto, mostra a estatística antes de perguntar o preço", () => {
    const r = receber("ask_product", {}, "s25 plus", STATS);
    expect(r.proximo).toBe("ask_price");
    expect(r.texto).toContain("23");
    expect(r.texto).toContain("R$ 3.150,00");
    expect(r.data.produto).toBe("s25 plus");
  });

  it("avisa quando não há histórico, sem travar o fluxo", () => {
    const r = receber("ask_product", {}, "produto raro", null);
    expect(r.proximo).toBe("ask_price");
    expect(r.texto.toLowerCase()).toContain("não achei");
  });

  it("depois do preço, oferece tolerâncias mostrando a faixa de cada uma", () => {
    const r = receber("ask_price", { produto: "s25 plus" }, "3000", STATS);
    expect(r.proximo).toBe("ask_tolerance");
    expect(r.data.alvoCents).toBe(300000);
    const rotulos =
      r.keyboard?.inline_keyboard
        .flat()
        .map((b) => b.text)
        .join(" ") ?? "";
    expect(rotulos).toContain("R$ 2.850,00");
    expect(rotulos).toContain("R$ 3.300,00");
  });

  it("aceita preço escrito com vírgula e com R$", () => {
    expect(receber("ask_price", {}, "R$ 3.000,50", STATS).data.alvoCents).toBe(300050);
  });

  it("repete a pergunta quando o preço não é número", () => {
    const r = receber("ask_price", { produto: "x" }, "barato", STATS);
    expect(r.proximo).toBe("ask_price");
    expect(r.texto.toLowerCase()).toContain("número");
  });

  it("depois da tolerância, pede confirmação mostrando a faixa", () => {
    const r = receber("ask_tolerance", { produto: "s25 plus", alvoCents: 300000 }, "10", STATS);
    expect(r.proximo).toBe("confirm");
    expect(r.texto).toContain("R$ 2.700,00");
    expect(r.texto).toContain("R$ 3.300,00");
    expect(r.data.tolerancePct).toBe(10);
  });

  it("rejeita tolerância fracionária, pra faixa mostrada não divergir do banco", () => {
    const r = receber("ask_tolerance", { produto: "s25 plus", alvoCents: 300000 }, "7.5", STATS);
    expect(r.proximo).toBe("ask_tolerance");
    expect(r.texto.toLowerCase()).toContain("inteiro");
  });

  it("confirmando, encerra o fluxo", () => {
    const d = { produto: "s25 plus", alvoCents: 300000, tolerancePct: 10 };
    expect(receber("confirm", d, "sim", STATS).proximo).toBe("done");
  });

  it("recusando, cancela", () => {
    const d = { produto: "s25 plus", alvoCents: 300000, tolerancePct: 10 };
    expect(receber("confirm", d, "não", STATS).proximo).toBe("cancel");
  });

  describe("confirmação — só um conjunto fechado de primeira palavra confirma (fix round 1)", () => {
    const d = { produto: "s25 plus", alvoCents: 300000, tolerancePct: 10 };

    it('"só um segundo" cancela, não confirma por começar com "s"', () => {
      expect(receber("confirm", d, "só um segundo", STATS).proximo).toBe("cancel");
    });

    it('"sei lá" cancela', () => {
      expect(receber("confirm", d, "sei lá", STATS).proximo).toBe("cancel");
    });

    it('"isso não, cancela" cancela mesmo "isso" estando no conjunto fechado', () => {
      expect(receber("confirm", d, "isso não, cancela", STATS).proximo).toBe("cancel");
    });

    it('"sim, pode criar" confirma', () => {
      expect(receber("confirm", d, "sim, pode criar", STATS).proximo).toBe("done");
    });

    it('"SIM" (maiúsculo) confirma', () => {
      expect(receber("confirm", d, "SIM", STATS).proximo).toBe("done");
    });
  });

  describe("negação em qualquer posição cancela, não só a segunda palavra (fix round 2)", () => {
    const d = { produto: "s25 plus", alvoCents: 300000, tolerancePct: 10 };

    it('"isso aí não" cancela (negação na terceira palavra)', () => {
      expect(receber("confirm", d, "isso aí não", STATS).proximo).toBe("cancel");
    });

    it('"isso mesmo não" cancela (negação na terceira palavra)', () => {
      expect(receber("confirm", d, "isso mesmo não", STATS).proximo).toBe("cancel");
    });

    it('"isso pode ser mas hoje não" cancela (negação no fim da frase)', () => {
      expect(receber("confirm", d, "isso pode ser mas hoje não", STATS).proximo).toBe("cancel");
    });

    it('"isso sim" continua confirmando (sem negação)', () => {
      expect(receber("confirm", d, "isso sim", STATS).proximo).toBe("done");
    });

    it('"pode sim" continua confirmando (sem negação)', () => {
      expect(receber("confirm", d, "pode sim", STATS).proximo).toBe("done");
    });
  });

  describe("estado corrompido não vira caça inventada (fix round 1)", () => {
    it("ask_tolerance sem alvoCents cancela em vez de assumir faixa 0-0", () => {
      const r = receber("ask_tolerance", { produto: "s25 plus" }, "10", STATS);
      expect(r.proximo).toBe("cancel");
      expect(r.texto.toLowerCase()).toContain("cacar");
    });

    it("confirm sem produto cancela em vez de confirmar caça sem nome", () => {
      const r = receber("confirm", { alvoCents: 300000, tolerancePct: 10 }, "sim", STATS);
      expect(r.proximo).toBe("cancel");
    });
  });

  describe("produto vazio não avança o fluxo (fix round 1)", () => {
    it("mensagem só com espaços continua em ask_product e pede de novo", () => {
      const r = receber("ask_product", {}, "   ", STATS);
      expect(r.proximo).toBe("ask_product");
      expect(r.texto.toLowerCase()).toContain("produto");
    });
  });
});
