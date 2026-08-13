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
      {
        codigo: "APROVEITAESSA",
        descontoTexto: null,
        pisoCents: null,
        tetoCents: null,
        beneficios: [],
        restricoes: [],
      },
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

  // Visto na lista real do /cupom amazon monitor: "FAMILIA — 106%". O 106 era
  // especificação do monitor (cobertura de cor), não desconto. Cupom acima de
  // 90% não existe.
  it("número acima de 90% não é desconto de cupom", () => {
    expect(extrairCupons("Monitor 106% sRGB cupom: FAMILIA")[0].descontoTexto).toBeNull();
    expect(extrairCupons("Tela 144% NTSC cupom: TESTE12")[0].descontoTexto).toBeNull();
  });

  it("porcentagem plausível continua sendo lida", () => {
    expect(extrairCupons("cupom: TOMA15 15% de desconto")[0].descontoTexto).toBe("15%");
    expect(extrairCupons("cupom: META90 90% de desconto")[0].descontoTexto).toBe("90%");
  });

  it("desconto e piso ficam nulos quando o post não diz", () => {
    const c = extrairCupons("Cupom: SEMPREMODA")[0];
    expect(c.descontoTexto).toBeNull();
    expect(c.pisoCents).toBeNull();
  });
});

describe("extrairCupons — benefício e restrições", () => {
  // Todas as strings abaixo saíram do arquivo real em 12/08. A medição sobre
  // 2.700 posts com cupom mostrou que **~80% só trazem o código**, sem dizer
  // regra nenhuma — por isso todo campo aqui é opcional e a mensagem tem que
  // ficar boa sem eles:
  //
  //   desconto em %            9%      teto "limitado a R$"      4%
  //   valor do desconto R$     7%      piso "em compras de"      3%
  //   piso "acima/a partir"    8%      frete grátis              2%
  //   1 uso por CPF            1%      itens selecionados        1%
  const um = (t: string) => extrairCupons(t)[0];

  it("piso: 'em compras acima de R$129'", () => {
    expect(um("Mercado Livre 10% OFF em compras acima de R$129 cupom: MARCOU").pisoCents).toBe(
      12900,
    );
  });

  it("piso: 'a partir de R$ 200'", () => {
    expect(um("Ganhe 10% off em compras a partir de R$ 200 cupom: BRASILHOJE").pisoCents).toBe(
      20000,
    );
  });

  it("piso: 'ACIMA DE R$200' sem a palavra compras", () => {
    expect(um("👉10% OFF ACIMA DE R$200 🎟 SEUMOMENTO").pisoCents).toBe(20000);
  });

  it("piso com milhar: 'a partir de R$ 999'", () => {
    expect(um("R$ 100 off em compras a partir de R$ 999 cupom: CHEGOUPRIME").pisoCents).toBe(99900);
  });

  // O ponto é separador de MILHAR em pt-BR, a vírgula é o decimal. Trocar os
  // papéis transforma R$ 1.299 em R$ 1,29 — erro de 100x num piso de compra,
  // que faria o cupom parecer utilizável em qualquer carrinho. O teste acima
  // não pegava isso: "R$ 999" não tem separador nenhum.
  it("piso com separador de milhar de verdade: 'a partir de R$ 1.299'", () => {
    expect(um("15% off a partir de R$ 1.299 cupom: MILHAR1").pisoCents).toBe(129900);
  });

  it("piso com centavos: 'acima de R$ 99,90'", () => {
    expect(um("10% off acima de R$ 99,90 cupom: CENT123").pisoCents).toBe(9990);
  });

  // Sem este caso, uma regex de piso que aceitasse "limite de" passava
  // despercebida: no post que tem os dois, "acima de" vem primeiro e o `exec`
  // devolve o certo por acidente de ordem. Descoberto por mutação.
  it("post que só tem teto não ganha piso inventado", () => {
    const c = um("25% OFF com limite de R$ 60 de desconto cupom: SOTETO1");
    expect(c.tetoCents).toBe(6000);
    expect(c.pisoCents).toBeNull();
  });

  // O teto é o que separa "10% de desconto" de "10% até no máximo R$40". Sem
  // ele o usuário faz a conta errada num carrinho grande.
  it("teto: 'limite de R$40'", () => {
    expect(um("10% OFF em compras acima de R$129, limite de R$40 cupom: MARCOU").tetoCents).toBe(
      4000,
    );
  });

  it("teto: '(limitado a R$ 50)'", () => {
    expect(um("10% off a partir de R$ 200 (limitado a R$ 50) cupom: BRASILHOJE").tetoCents).toBe(
      5000,
    );
  });

  it("teto: 'limite de R$ 60 de desconto'", () => {
    expect(um("🎟 CUPOMPRAMOVEIS 25% OFF com limite de R$ 60 de desconto").tetoCents).toBe(6000);
  });

  it("piso e teto no mesmo post não se confundem", () => {
    const c = um("10% OFF em compras acima de R$129, limite de R$40 cupom: MARCOU");
    expect(c.pisoCents).toBe(12900);
    expect(c.tetoCents).toBe(4000);
  });

  it("restrição: 1 utilização por CPF", () => {
    expect(
      um("cupom: ALOCUPOM (Válido para 1 utilização por CPF em itens selecionados)").restricoes,
    ).toContain("1 uso por CPF");
  });

  it("restrição: itens selecionados", () => {
    expect(um("cupom: MAGALUCHEGOU (Válido em itens selecionados)").restricoes).toContain(
      "itens selecionados",
    );
  });

  it("restrição: exclusivo para assinante", () => {
    expect(
      um("cupom TORCER15 (Exclusivo para membros Prime. Válido em itens selecionados)").restricoes,
    ).toContain("só assinante Prime");
  });

  // "Placa Mãe Asus Prime A520m" aparece no arquivo e não é restrição nenhuma
  // — a palavra prime é nome de produto. Precisa do contexto de assinatura.
  it("Prime no nome do produto não vira restrição", () => {
    expect(um("🔥Placa Mãe Asus Prime A520m-r Am4 cupom: TECHEMCASA").restricoes).toEqual([]);
  });

  it("benefício: frete grátis entra como vantagem, não restrição", () => {
    const c = um("cupom: FRETEZERO com Frete Grátis para todo o Brasil");
    expect(c.beneficios).toContain("frete grátis");
    expect(c.restricoes).not.toContain("frete grátis");
  });

  it("post que só traz o código deixa tudo vazio, sem inventar", () => {
    const c = um("🎟️Use o cupom: APROVEITAESSA");
    expect(c.pisoCents).toBeNull();
    expect(c.tetoCents).toBeNull();
    expect(c.restricoes).toEqual([]);
    expect(c.beneficios).toEqual([]);
  });

  it("não repete a mesma restrição quando o post a menciona duas vezes", () => {
    const c = um("cupom: X1Y2 válido em itens selecionados, apenas itens selecionados");
    expect(c.restricoes.filter((r) => r === "itens selecionados")).toHaveLength(1);
  });
});

describe("extrairCupons — regra é do cupom, não do produto", () => {
  // A maioria dos posts é anúncio de PRODUTO que por acaso carrega um cupom.
  // Sem limitar o raio, o "Frete Grátis" e o "assinantes Meli+" do anúncio
  // eram creditados ao código: a primeira renderização real do /cupom saiu com
  // "APROVEITAESSA — frete grátis", que é propaganda do produto.
  //
  // Medido nos posts de 3 dias de Amazon e ML: post inteiro dá 254
  // atribuições, ±120 caracteres dá 131 — metade não tinha relação.
  it("frete grátis do produto, longe do código, não vira benefício do cupom", () => {
    const t = [
      "🎧 Fone de ouvido Anker Soundcore",
      "📦 Frete Grátis para todo o Brasil",
      "Vendido e entregue por Amazon, chega em 2 dias, garantia de 1 ano",
      "Produto original com nota fiscal e 30 dias para troca sem custo nenhum",
      "Avaliação 4,8 estrelas com mais de doze mil compradores satisfeitos",
      "Use o cupom: LONGE123",
    ].join("\n");
    expect(extrairCupons(t)[0].beneficios).toEqual([]);
  });

  it("frete grátis colado no código continua valendo", () => {
    expect(extrairCupons("Use o cupom: PERTO123 e ganhe Frete Grátis")[0].beneficios).toEqual([
      "frete grátis",
    ]);
  });

  it("cada código de um post lê a sua própria vizinhança", () => {
    const t = [
      "Cupom: PRIMEIRO com 10% OFF acima de R$ 200",
      "".padEnd(200, "x"),
      "Cupom: SEGUNDO válido para 1 utilização por CPF",
    ].join("\n");
    const [a, b] = extrairCupons(t);
    expect(a.pisoCents).toBe(20000);
    expect(a.restricoes).toEqual([]);
    expect(b.pisoCents).toBeNull();
    expect(b.restricoes).toContain("1 uso por CPF");
  });
});
