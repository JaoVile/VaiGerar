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
});
