import { describe, expect, it } from "vitest";
import { casa, casaPerto, faixaDe } from "@/lib/hunts/match";
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

describe("casaPerto — aviso de aproximação", () => {
  // Existe porque as 6 caças reais tinham alvo 2% a 7% abaixo do que o mercado
  // já praticou e passaram 3 meses sem disparar nenhuma vez. Sem o aviso o
  // sistema fica mudo mesmo quando o preço encosta.
  const h = {
    ...hunt,
    priceMinCents: 150000,
    priceMaxCents: 300000,
  };

  it("preço até 8% acima do teto vira aviso", () => {
    expect(casaPerto("Galaxy S25+ 256GB", 310000, h)).toBe(true);
    // 300000 * 1,08 = 324000, o limite exato entra
    expect(casaPerto("Galaxy S25+ 256GB", 324000, h)).toBe(true);
  });

  it("acima da margem não vira aviso", () => {
    expect(casaPerto("Galaxy S25+ 256GB", 324001, h)).toBe(false);
    expect(casaPerto("Galaxy S25+ 256GB", 400000, h)).toBe(false);
  });

  // Se está dentro da faixa é ALERTA, não aviso. As duas mensagens têm tom
  // diferente e não podem sair as duas pro mesmo post.
  it("preço dentro da faixa não é aviso", () => {
    expect(casaPerto("Galaxy S25+ 256GB", 290000, h)).toBe(false);
    expect(casa("Galaxy S25+ 256GB", 290000, h)).toBe(true);
  });

  // Preço mal lido é barrado por estar ABAIXO do teto, não pelo piso: o aviso
  // só existe acima do teto. A primeira versão deste teste dizia que era o
  // piso que barrava, e por isso passava mesmo com a checagem de piso apagada.
  it("preço mal lido não vira aviso — está abaixo do teto, não acima", () => {
    expect(casaPerto("Galaxy S25+ 256GB", 414, h)).toBe(false);
    expect(casaPerto("Galaxy S25+ 256GB", h.priceMaxCents, h)).toBe(false);
  });

  it("aviso respeita os mesmos termos do alerta", () => {
    expect(casaPerto("Capa para Galaxy S25+", 310000, h)).toBe(false);
    expect(casaPerto("Galaxy S25 Ultra 512GB", 310000, { ...h, termsAny: ["galaxy s25"] })).toBe(
      false,
    );
  });
});

describe("casa — piso de sanidade", () => {
  // Um Galaxy S26 5G 256GB real saiu por R$ 2.579 em 25/05 e foi descartado
  // porque o piso da caça era R$ 2.610. O usuário pediu R$ 2.900 — a oferta
  // era R$ 321 MELHOR e o sistema ficou calado.
  //
  // A tolerância diz quanto ACIMA do alvo se aceita; abaixo é sempre melhor.
  // O piso só existe pra barrar lixo.
  const s26 = {
    ...hunt,
    label: "Galaxy S26",
    termsAny: ["galaxy s26"],
    priceMinCents: 145000,
    priceMaxCents: 319000,
  };

  it("oferta melhor que o alvo entra em vez de ser rejeitada", () => {
    expect(casa("Samsung Galaxy S26 5G 256GB 12GB RAM", 257900, s26)).toBe(true);
  });

  it("lixo continua barrado", () => {
    // Capa de R$ 29 e preço mal lido de R$ 4,14 ficam fora do piso.
    expect(casa("Samsung Galaxy S26 5G capinha", 2900, s26)).toBe(false);
    expect(casa("Samsung Galaxy S26 5G 256GB", 414, s26)).toBe(false);
  });
});
