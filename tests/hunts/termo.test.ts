import { describe, expect, it } from "vitest";
import { casaTermo } from "@/lib/hunts/termo";

describe("casaTermo — qualificador de modelo", () => {
  // O defeito mais caro, medido em 12.000 posts reais em 2026-08-12: de 79
  // posts que casavam `galaxy s25` por substring, **48 (61%) eram outro
  // aparelho** — S25 Ultra, S25 FE, S25 Plus. A caça Galaxy S25 tem alvo de
  // R$ 2.600; casar um Ultra é alerta errado sobre produto errado.
  it("modelo base não casa o modelo superior", () => {
    expect(casaTermo("samsung galaxy s25 ultra 256gb", "galaxy s25")).toBe(false);
    expect(casaTermo("samsung galaxy s25 fe 5g 128gb", "galaxy s25")).toBe(false);
    expect(casaTermo("galaxy s26 ultra 256gb 5g", "galaxy s26")).toBe(false);
  });

  it("modelo base continua casando o modelo base", () => {
    expect(casaTermo("smartphone samsung galaxy s25 256gb 5g", "galaxy s25")).toBe(true);
    expect(casaTermo("galaxy s25 5g 128gb 8gb ram", "galaxy s25")).toBe(true);
  });

  // "5G", "256GB" e cor não são qualificador de linha — se entrassem na lista,
  // a caça do modelo base pararia de casar qualquer anúncio real.
  it("especificação depois do modelo não conta como qualificador", () => {
    expect(casaTermo("galaxy s25 5g dual sim", "galaxy s25")).toBe(true);
    expect(casaTermo("galaxy s25 256gb preto", "galaxy s25")).toBe(true);
  });

  it("caça do modelo superior casa o modelo superior", () => {
    expect(casaTermo("samsung galaxy s24 ultra 512gb", "s24 ultra")).toBe(true);
    expect(casaTermo("galaxy s25 edge 256gb", "s25 edge")).toBe(true);
  });

  // O `+` tem que sobreviver à tokenização. Se `s25+` virasse o token `s25`,
  // a caça do Plus casaria o modelo base e vice-versa — as duas caças existem
  // ao mesmo tempo, com alvos diferentes (R$ 3.000 e R$ 2.600).
  it("s25+ e s25 são termos diferentes", () => {
    expect(casaTermo("galaxy s25+ 256gb", "s25+")).toBe(true);
    expect(casaTermo("galaxy s25+ 256gb", "galaxy s25")).toBe(false);
    expect(casaTermo("galaxy s25 256gb", "s25+")).toBe(false);
  });
});

describe("casaTermo — termo como modificador", () => {
  // Medido: 27% dos posts que casam "mesa" trazem "de mesa" — é ventilador,
  // luminária, suporte. Em "cadeira" e "fone" a taxa é de 1 a 2%, então a
  // regra ajuda onde dói e quase não toca no resto.
  it("termo depois de preposição é modificador, não o produto", () => {
    expect(casaTermo("ventilador de mesa 40cm", "mesa")).toBe(false);
    expect(casaTermo("suporte para mesa articulado", "mesa")).toBe(false);
  });

  it("termo como substantivo principal continua casando", () => {
    expect(casaTermo("mesa de escritorio em l 1,50m", "mesa")).toBe(true);
    expect(casaTermo("mesa gamer 120cm", "mesa")).toBe(true);
  });
});

describe("casaTermo — limite de palavra", () => {
  // Este é o modo de erro que o plano original queria atacar. Medido: 4 a 9
  // posts em 12.000. Entra junto porque a tokenização já foi escrita para os
  // outros dois casos, não porque valesse sozinho.
  it("termo colado dentro de palavra maior não casa", () => {
    expect(casaTermo("mesada infantil brinquedo", "mesa")).toBe(false);
    expect(casaTermo("transmissao s25x", "s25")).toBe(false);
  });

  it("acento e caixa não atrapalham", () => {
    expect(casaTermo("MESA DE JANTAR", "mesa")).toBe(true);
    expect(casaTermo("Cadeira Ergonômica", "ergonomica")).toBe(true);
  });

  it("termo de várias palavras precisa aparecer junto e na ordem", () => {
    expect(casaTermo("galaxy s25 plus", "s25 plus")).toBe(true);
    expect(casaTermo("plus galaxy s25", "s25 plus")).toBe(false);
    expect(casaTermo("s25 muito plus", "s25 plus")).toBe(false);
  });

  it("texto vazio ou termo vazio não casa e não lança", () => {
    expect(casaTermo("", "mesa")).toBe(false);
    expect(casaTermo("mesa", "")).toBe(false);
  });
});
