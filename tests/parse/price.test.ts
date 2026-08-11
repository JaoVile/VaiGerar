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

describe("parsePrices — cupom não é preço", () => {
  it("ignora cupom escrito como 'cupom R$ X OFF'", () => {
    const r = parsePrices("aplicar o cupom R$ 30 OFF na página. VALOR DA OFERTA R$ 3.967");
    expect(r.priceCents).toBe(396700);
    expect(r.pricesCents).not.toContain(3000);
  });

  it("ignora 'Aplique R$ 30 OFF no anúncio'", () => {
    const r = parsePrices("Por apenas: R$ 3.967,99\nAplique R$ 30 OFF no anúncio");
    expect(r.priceCents).toBe(396799);
  });

  it("ignora vários cupons no mesmo post", () => {
    const r = parsePrices(
      "Resgate o cupom de R$ 80. Depois o cupom de R$ 500. VALOR DA OFERTA R$ 2.499 - ANTES R$ 3.099",
    );
    expect(r.priceCents).toBe(249900);
    expect(r.pricesCents).toEqual([249900, 309900]);
  });

  it("ignora 'desconto de R$ X'", () => {
    expect(parsePrices("desconto de R$ 50 no PIX. Por R$ 899,00").priceCents).toBe(89900);
  });

  it("não confunde preço legítimo que só menciona a palavra longe do valor", () => {
    const r = parsePrices("Cupom disponível na loja para outros produtos.\n\nPor R$ 1.299,00");
    expect(r.priceCents).toBe(129900);
  });

  it("continua descartando parcela", () => {
    const r = parsePrices("por R$ 3.299,00 à vista ou 12x de R$ 274,91");
    expect(r.pricesCents).toEqual([329900]);
  });

  it("rede de segurança: post que é só cupom devolve o cupom em vez de null", () => {
    // Quando todos os valores são cupom, a rede de segurança devolve os valores
    // sem filtro em vez de deixar o post sem preço. Isso previne que o filtro
    // transforme um post com valores num post sem preço.
    const r = parsePrices("Resgate o cupom de R$ 80");
    expect(r.priceCents).toBe(8000);
    expect(r.pricesCents).toEqual([8000]);
  });

  it("rede de segurança não desliga o filtro quando há preço legítimo", () => {
    // Quando há um preço legítimo além do cupom, o filtro continua funcionando
    // e descarta o cupom.
    const r = parsePrices("cupom R$ 30 OFF na página. VALOR DA OFERTA R$ 3.967");
    expect(r.priceCents).toBe(396700);
    expect(r.pricesCents).not.toContain(3000);
  });

  it("ignora 'código de R$ X'", () => {
    expect(parsePrices("use o código e ganhe R$ 40. Por R$ 899,00").priceCents).toBe(89900);
  });
});
