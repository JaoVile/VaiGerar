import { describe, expect, it } from "vitest";
import { htmlToText, parsePrices, toCents } from "@/lib/parse/price";

describe("toCents", () => {
  it("converte formato BR com centavos", () => {
    expect(toCents("3.149,10")).toBe(314910);
  });
  it("converte sem centavos, ponto é milhar", () => {
    expect(toCents("2.000")).toBe(200000);
  });
  it("converte número curto", () => {
    expect(toCents("299")).toBe(29900);
  });
});

describe("htmlToText", () => {
  it("remove trecho riscado antes de virar texto", () => {
    expect(htmlToText("De <s>R$ 4.199,00</s> por R$ 3.299,00")).not.toContain("4.199");
  });
  it("converte <br> em quebra de linha e decodifica entidades", () => {
    expect(htmlToText("a<br/>b &amp; c")).toBe("a\nb & c");
  });

  it("decodifica referência numérica decimal (ex.: R&#036; do gt.OFERTAS)", () => {
    expect(htmlToText("R&#036;3.149,10")).toContain("R$");
  });

  it("decodifica referência numérica hexadecimal", () => {
    expect(htmlToText("R&#x24;3.149,10")).toContain("R$");
  });

  it("decodifica numéricas antes das nomeadas, sem dupla-decodificação", () => {
    expect(htmlToText("&amp;#036;")).toBe("&#036;");
  });

  it("devolve a sequência original quando o code point é inválido", () => {
    expect(htmlToText("&#99999999;")).toBe("&#99999999;");
  });
});

describe("parsePrices", () => {
  it("pega preço colado no cifrão (padrão CT Ofertas)", () => {
    const r = parsePrices("A partir de R$3.149,10");
    expect(r.priceCents).toBe(314910);
  });

  it("pega preço com espaço depois do cifrão (padrão gt.OFERTAS)", () => {
    expect(parsePrices("Por R$ 4.475,00").priceCents).toBe(447500);
  });

  it("descarta parcela e fica com o preço à vista", () => {
    const r = parsePrices("por R$ 3.299,00 à vista ou 12x de R$ 274,91");
    expect(r.pricesCents).toEqual([329900]);
    expect(r.priceCents).toBe(329900);
  });

  it("descarta o preço riscado e devolve só o vigente", () => {
    const r = parsePrices("De <s>R$ 4.199,00</s> por R$ 3.299,00");
    expect(r.pricesCents).toEqual([329900]);
  });

  it("sem riscado, guarda os dois e usa o menor", () => {
    const r = parsePrices("De R$ 4.199,00 por R$ 3.299,00");
    expect(r.pricesCents).toEqual([329900, 419900]);
    expect(r.priceCents).toBe(329900);
  });

  it("devolve null quando não há preço", () => {
    const r = parsePrices("Siga o canal e ative as notificações!");
    expect(r.priceCents).toBeNull();
    expect(r.pricesCents).toEqual([]);
  });

  it("ignora valores irrisórios abaixo de R$1", () => {
    expect(parsePrices("cupom de R$ 0,50").priceCents).toBeNull();
  });

  it("pega preço com o cifrão em referência numérica (ex.: gt.OFERTAS real)", () => {
    expect(parsePrices("A partir de R&#036;3.149,10").priceCents).toBe(314910);
  });
});
