import { describe, expect, it } from "vitest";
import { casa, faixaDe } from "@/lib/hunts/match";
import { normalizar, variantes } from "@/lib/hunts/terms";

describe("normalizar", () => {
  it("tira acento e caixa", () => {
    expect(normalizar("Calça AÇÃO")).toBe("calca acao");
  });
});

describe("variantes", () => {
  it("gera a forma com + para 'plus'", () => {
    expect(variantes("s25 plus")).toContain("s25+");
  });
  it("gera a forma com 'plus' quando veio com +", () => {
    expect(variantes("s25+")).toContain("s25 plus");
  });
  it("mantém a consulta original normalizada", () => {
    expect(variantes("Galaxy S25 Plus")).toContain("galaxy s25 plus");
  });
});

describe("faixaDe", () => {
  it("aplica a tolerância em cima do alvo", () => {
    expect(faixaDe(300000, 5)).toEqual({ minCents: 285000, maxCents: 315000 });
  });
  it("tolerância de 10% abre a faixa", () => {
    expect(faixaDe(300000, 10)).toEqual({ minCents: 270000, maxCents: 330000 });
  });
  it("arredonda para centavo inteiro", () => {
    expect(faixaDe(99900, 5).minCents).toBe(94905);
  });
});

const hunt = {
  id: "h1",
  chatId: 1,
  label: "S25+",
  query: "s25 plus",
  termsAny: ["s25+", "s25 plus"],
  termsNone: ["capa", "pelicula", "seminovo"],
  priceMinCents: 285000,
  priceMaxCents: 315000,
};

describe("casa", () => {
  it("casa produto na faixa", () => {
    expect(casa("Galaxy S25 Plus 256GB por R$ 2.999", 299900, hunt)).toBe(true);
  });
  it("casa ignorando acento e caixa", () => {
    expect(casa("GALAXY S25+ 512GB", 299900, hunt)).toBe(true);
  });
  it("recusa preço abaixo da faixa (a capa de R$29)", () => {
    expect(casa("Capa para Galaxy S25 Plus", 2900, hunt)).toBe(false);
  });
  it("recusa preço acima da faixa", () => {
    expect(casa("Galaxy S25 Plus", 320000, hunt)).toBe(false);
  });
  it("recusa quando bate termo proibido, mesmo na faixa", () => {
    expect(casa("Galaxy S25 Plus seminovo", 299900, hunt)).toBe(false);
  });
  it("recusa quando nenhum termo obrigatório aparece", () => {
    expect(casa("Galaxy S24 Ultra", 299900, hunt)).toBe(false);
  });
  it("recusa post sem preço", () => {
    expect(casa("Galaxy S25 Plus", null, hunt)).toBe(false);
  });
});
