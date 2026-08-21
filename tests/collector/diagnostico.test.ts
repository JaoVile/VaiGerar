import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  diagnosticar,
  estimarPostsPorDia,
  LIMIAR_CUPOM,
  medianaCents,
  normalizarSlug,
  veredito,
} from "@/lib/collector/diagnostico";

const fixture = (nome: string) => readFileSync(join(__dirname, "..", "fixtures", nome), "utf8");

describe("normalizarSlug", () => {
  it("aceita o que dá pra copiar do Telegram", () => {
    for (const entrada of [
      "pechinchou",
      "@pechinchou",
      "t.me/pechinchou",
      "https://t.me/pechinchou",
      "https://t.me/s/pechinchou",
      "https://www.t.me/pechinchou?single",
      "  t.me/pechinchou/1234  ",
    ]) {
      expect(normalizarSlug(entrada)).toBe("pechinchou");
    }
  });

  it("recusa o que o Telegram não aceitaria como username", () => {
    for (const ruim of ["", "abc", "com-hifen", "espaço aqui", "a".repeat(33), "t.me/"]) {
      expect(normalizarSlug(ruim)).toBeNull();
    }
  });

  it("não confunde o prefixo /s/ com um canal chamado s", () => {
    expect(normalizarSlug("t.me/s/sofertas")).toBe("sofertas");
  });
});

describe("medianaCents", () => {
  it("um preço mal lido não move a mediana", () => {
    // R$ 4,14 num Galaxy: o caso real que a 0008 cita.
    expect(medianaCents([414, 299_900, 310_000, 289_900, 305_000])).toBe(299_900);
  });

  it("lista vazia é null, não zero — zero seria um preço", () => {
    expect(medianaCents([])).toBeNull();
  });
});

describe("estimarPostsPorDia", () => {
  it("extrapola o intervalo da página", () => {
    const posts = [
      { postedAt: "2026-08-21T12:00:00Z" },
      { postedAt: "2026-08-21T18:00:00Z" },
      { postedAt: "2026-08-22T00:00:00Z" },
    ] as never[];
    // 2 intervalos em meio dia -> 4/dia.
    expect(estimarPostsPorDia(posts)).toBeCloseTo(4, 5);
  });

  it("posts no mesmo minuto não viram milhares por dia", () => {
    const posts = Array.from({ length: 5 }, () => ({
      postedAt: "2026-08-21T12:00:00Z",
    })) as never[];
    expect(estimarPostsPorDia(posts)).toBe(5);
  });
});

describe("diagnosticar", () => {
  it("lê um canal real com o parser do projeto", () => {
    const d = diagnosticar(fixture("ctofertascelulares.html"), "ctofertascelulares");
    expect(d.indisponivel).toBeNull();
    expect(d.postsNaPagina).toBeGreaterThan(0);
    expect(d.comPreco).toBeGreaterThan(0);
    expect(d.amostra.length).toBeGreaterThan(0);
    expect(veredito(d).pode).toBe(true);
  });

  it("página sem preview é recusada — é o caso de canal privado e slug errado", () => {
    // t.me/s/<slug> de canal privado ou inexistente redireciona pro cartão de
    // contato: HTTP 200, sem `tgme_channel_info`.
    const contato =
      '<html><head><meta property="og:title" content="Telegram: Contact @x"></head><body></body></html>';
    const d = diagnosticar(contato, "canalprivado");
    expect(d.indisponivel).toBe("sem-preview");
    expect(veredito(d).pode).toBe(false);
  });

  it("canal que abre mas não rende post é recusado, não cadastrado vazio", () => {
    const d = diagnosticar(fixture("vazio.html"), "morto");
    expect(veredito(d).pode).toBe(false);
  });

  it("HTML mudado pelo t.me não passa por canal bom", () => {
    // Mesmo cenário do canário do tick: âncora existe, corpo não é lido.
    const d = diagnosticar(fixture("quebrado.html"), "qualquer");
    expect(veredito(d).pode).toBe(false);
  });

  it("canal de cupom é barrado — hoje pelo silêncio, não pela sujeira", () => {
    // Os quatro textos são dos canais que a 0006 rejeitou à mão. Desde a
    // correção de 10/08 o parser descarta valor de desconto, então nenhum
    // deles devolve preço: o canal entraria e nunca casaria uma caça.
    const html = cupomFixture([
      "10% de desconto em R$0 (Limite de R$10)",
      "R$15 de desconto em R$75",
      "20% de desconto em R$39 (Limite de R$50)",
      "R$400 de desconto em R$2.000",
    ]);
    const d = diagnosticar(html, "SoCuponsCCBR");
    expect(d.comPreco).toBe(0);
    expect(d.cheiroDeCupom).toBeGreaterThanOrEqual(LIMIAR_CUPOM);

    const v = veredito(d);
    expect(v.pode).toBe(false);
    expect(v.tom).toBe("crit");
    // A tela precisa dizer POR QUE, não só "não".
    expect(v.texto).toMatch(/cupom/i);
  });

  it("post com cupom não é canal de cupom — 29% do arquivo tem código", () => {
    const html = cupomFixture([
      "Galaxy S24 Ultra 256GB por R$ 3.499,00 cupom: SAIU100",
      "Notebook Acer i5 por R$ 2.799,00 🎟 CALOR",
      "Fone JBL por R$ 199,00",
      "R$50 de desconto em R$300",
    ]);
    const d = diagnosticar(html, "ctofertascelulares");
    expect(d.comPreco).toBe(3);
    expect(veredito(d).pode).toBe(true);
  });

  it("canal legítimo mas sem preço legível não entra só porque abre", () => {
    const html = cupomFixture([
      "Chegou coisa nova na loja, corre lá",
      "Bom dia, promoções em instantes",
      "Link do grupo VIP na bio",
      "Sorteio hoje às 20h",
    ]);
    const d = diagnosticar(html, "sopapo");
    expect(d.cheiroDeCupom).toBe(0);
    const v = veredito(d);
    expect(v.pode).toBe(false);
    expect(v.texto).toMatch(/preço legível/);
  });
});

/** Página mínima no formato que o parser espera, com um post por texto. */
function cupomFixture(textos: string[]): string {
  const posts = textos
    .map(
      (t, i) => `<div class="tgme_widget_message" data-post="canal/${i + 1}">
        <time datetime="2026-08-2${i}T12:00:00+00:00"></time>
        <div class="tgme_widget_message_text js-message_text">${t}</div>
      </div>`,
    )
    .join("\n");
  return `<html><body><div class="tgme_channel_info"></div>${posts}</body></html>`;
}
