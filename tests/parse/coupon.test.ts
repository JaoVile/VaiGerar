import { describe, expect, it } from "vitest";
import { extrairCupons } from "@/lib/parse/coupon";

describe("extrairCupons", () => {
  // Formatos medidos em 10.000 posts reais do arquivo, em 2026-08-12:
  //   "cupom: CODIGO"   2.226 ocorrências
  //   "🎟 CODIGO"          807
  //   "use o cupom X"        4
  //   "código: X"            1
  it("pega o formato dominante — cupom com dois-pontos", () => {
    expect(extrairCupons("🎟️Use o cupom: APROVEITAESSA")).toEqual([
      { codigo: "APROVEITAESSA", descontoTexto: null, pisoCents: null },
    ]);
  });

  it("pega o código depois do emoji de ticket, sem a palavra cupom", () => {
    expect(extrairCupons("🎟 MELIPREFERIDO").map((c) => c.codigo)).toEqual(["MELIPREFERIDO"]);
  });

  it("aceita código com dígito e com hífen", () => {
    expect(extrairCupons("Cupom: APR0V3IT8AF").map((c) => c.codigo)).toEqual(["APR0V3IT8AF"]);
    expect(extrairCupons("cupom TOMA-15").map((c) => c.codigo)).toEqual(["TOMA-15"]);
  });

  // "Use o cupom ABAIXO" e "cupom AQUI" aparecem no arquivo e não são código
  // nenhum — é a frase apontando pro código que vem depois. Sem esta lista o
  // /cupom mostraria ABAIXO e ADEUS como se fossem cupons de verdade.
  it("descarta palavra do português que não é código", () => {
    expect(extrairCupons("Use o cupom ABAIXO")).toEqual([]);
    expect(extrairCupons("cupom: AQUI")).toEqual([]);
    expect(extrairCupons("O CUPOM está na página")).toEqual([]);
  });

  // Apareceu na primeira lista real do /cupom, em 12/08: "AMAZON — R$150 de

  // desconto" e "MERCADO — 15%" no topo, como se fossem código.

  it("nome de loja não vira código", () => {
    expect(extrairCupons("cupom Amazon R$150 de desconto")).toEqual([]);

    expect(extrairCupons("cupom MERCADO livre 15%")).toEqual([]);
  });

  it("cupom que contém nome de loja continua valendo", () => {
    expect(extrairCupons("cupom: MELICUPOM").map((c) => c.codigo)).toEqual(["MELICUPOM"]);

    expect(extrairCupons("cupom: TUDOAMAZON").map((c) => c.codigo)).toEqual(["TUDOAMAZON"]);
  });

  it("descarta código só de dígitos e repetição sem sentido", () => {
    expect(extrairCupons("cupom: 12345")).toEqual([]);
    expect(extrairCupons("cupom: AAAA")).toEqual([]);
  });

  // O flag `i` da regex é pra casar "Cupom:"/"CUPOM:", não pra aceitar código

  // minúsculo. Sem a checagem de caixa isto vira o cupom `válido`.

  it("frase em minúscula depois de cupom não vira código", () => {
    expect(extrairCupons("cupom válido até amanhã")).toEqual([]);

    expect(extrairCupons("Cupom: promocional na sacola")).toEqual([]);
  });

  it("não inventa cupom em post que não tem", () => {
    expect(extrairCupons("Galaxy S25+ 256GB por R$ 2.899,00")).toEqual([]);
  });

  it("devolve cada código uma vez só, mesmo repetido no post", () => {
    const t = "Cupom: TECHEMCASA\nAplique o cupom TECHEMCASA na sacola";
    expect(extrairCupons(t).map((c) => c.codigo)).toEqual(["TECHEMCASA"]);
  });

  it("extrai vários códigos distintos do mesmo post", () => {
    const t = "🎟 PRIMEIRO\n🎟 SEGUNDO";
    expect(extrairCupons(t).map((c) => c.codigo)).toEqual(["PRIMEIRO", "SEGUNDO"]);
  });

  // Medido: só 15% dos posts com cupom trazem o valor do desconto e 12% o
  // piso de compra. Por isso os dois campos são opcionais — a mensagem tem
  // que ficar boa sem eles, que é o caso comum.
  it("captura o valor do desconto quando o post traz", () => {
    expect(extrairCupons("Cupom: NOTE400 - R$400 OFF")[0].descontoTexto).toBe("R$400 OFF");
    expect(extrairCupons("Cupom: TOMA15 15% de desconto")[0].descontoTexto).toBe("15%");
  });

  it("captura o piso de compra quando o post traz", () => {
    expect(extrairCupons("Cupom: OIPRIME15 em compras acima de R$ 200")[0].pisoCents).toBe(20000);
  });

  it("desconto e piso ficam nulos quando o post não diz", () => {
    const c = extrairCupons("Cupom: SEMPREMODA")[0];
    expect(c.descontoTexto).toBeNull();
    expect(c.pisoCents).toBeNull();
  });
});
