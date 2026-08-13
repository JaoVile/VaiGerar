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

describe("parsePrices — post que é lista de cupom não tem preço", () => {
  // Itens 3 e 4 do FOLLOW-UPS. Todos os textos abaixo são reais e, antes desta
  // rodada, viravam preço de produto — e portanto entravam na mediana, que é a
  // régua que o sistema inteiro usa pra dizer se um preço é bom.
  //
  // Medido sobre 10.000 posts do arquivo: o preço muda em 478 (4,8%), sendo
  // 386 que passam a não ter preço nenhum. Sobram ~22 posts (0,22%) de cauda
  // longa, com formatos únicos — registrados em docs/FOLLOW-UPS.md.
  const preco = (t: string) => parsePrices(t).priceCents;

  it("piso de compra depois de desconto não é preço", () => {
    expect(preco("CUPONS MERCADO LIVRE 18% de desconto em R$29 (Limitado R$500)")).toBeNull();
    expect(preco("🎟 R$15 de desconto em R$75 Utilize na sacola")).toBeNull();
    expect(
      preco("🔥 CUPOM AMAZON 10% off em compras a partir de R$ 200 (limitado a R$40)"),
    ).toBeNull();
  });

  it("teto do desconto não é preço, em todas as formas do arquivo", () => {
    expect(preco("20% de desconto em R$39 (Limite de R$50)")).toBeNull();
    expect(preco("🏷 10% OFF em R$ 200, máx de R$ 40 OFF")).toBeNull();
    expect(preco("Cupom 10% OFF Acima de R$79 (Lim. R$100) no Mercado Livre")).toBeNull();
    expect(preco("🎟 10% OFF até R$ 2500: DIATV10")).toBeNull();
  });

  it("valor somado no checkout não é preço", () => {
    expect(preco("🎟 BRASILPRIME + R$200 na finalização")).toBeNull();
    expect(preco("Cupom BRASIL10 + R$50 de desconto na finalização da compra")).toBeNull();
  });

  // O piso costuma aparecer longe do "% OFF", fora da janela de contexto —
  // "10% OFF no Mercado Livre (Lim. R$ 100) | Compras acima de R$399". Por isso
  // "compras acima de" vale sozinho.
  it("'Compras acima de R$X' vale como piso mesmo longe do desconto", () => {
    const t = "[Oferta Relâmpago] 10% OFF no Mercado Livre (Lim. R$ 100) | Compras acima de R$399";
    expect(preco(t)).toBeNull();
  });

  // A rede de segurança existe pra uma palavra solta não apagar o preço de um
  // post legítimo. Ela continua valendo — só não protege mais o valor que uma
  // FRASE INTEIRA já disse não ser preço.
  // Este é o caso que a condição da rede de segurança de fato protege, e a
  // primeira versão dos testes não cobria: um valor cai no descarte FRACO
  // ("R$ 10 OFF") e o outro no FORTE ("OFF em R$ 40"). Sem a condição, a rede
  // devolveria o R$ 10 — o pior dos dois para a mediana, por ser o menor.
  // Descoberto por mutação: trocar a condição por `false` mantinha tudo verde.
  it("valor fraco não sobrevive quando o outro caiu no descarte forte", () => {
    expect(preco("🔠 NOVO CUPOM SHOPEE! R$ 10 OFF em R$ 40 - Cupom: SHOPEE10")).toBeNull();
  });

  it("post de produto com cupom mantém o preço do produto", () => {
    expect(preco("Air Fryer Mondial 5L por R$ 299,00 cupom: TECH10")).toBe(29900);
    expect(preco("Aplique o cupom R$ 30 OFF — Notebook por R$ 2.499,00")).toBe(249900);
  });

  it("rede de segurança segue de pé quando o descarte é só fraco", () => {
    // Único valor do post, marcado como cupom. Sem a rede viraria "sem preço".
    expect(preco("Aplique o cupom R$ 30 OFF na sacola")).toBe(3000);
  });

  // Ganho não previsto: o piso de compra era MENOR que o produto, e como o
  // preço escolhido é o mínimo, ele vencia. Um notebook de R$ 3.394 estava
  // arquivado como R$ 200.
  it("piso de compra não rouba o lugar do preço do produto", () => {
    expect(preco("Notebook R$ 2.499,00 · 10% off acima de R$ 200")).toBe(249900);
  });
});
