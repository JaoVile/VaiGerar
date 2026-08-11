import { describe, expect, it } from "vitest";
import { formatAjuda, formatBRL, formatSearch } from "@/lib/bot/format";
import { MESES_PADRAO } from "@/lib/search/query";
import { escapeHtml } from "@/lib/telegram";

describe("escapeHtml", () => {
  it("escapa os três caracteres que quebram o HTML do Telegram", () => {
    expect(escapeHtml('a<b>&"')).toBe('a&lt;b&gt;&amp;"');
  });
});

describe("formatBRL", () => {
  it("formata centavos no padrão brasileiro", () => {
    expect(formatBRL(396799)).toBe("R$ 3.967,99");
  });
  it("formata valor redondo com centavos zerados", () => {
    expect(formatBRL(300000)).toBe("R$ 3.000,00");
  });
});

describe("formatSearch", () => {
  const base = {
    termo: "air fryer",
    stats: { count: 41, minCents: 12900, medianCents: 29700, maxCents: 85994 },
    melhores: [
      {
        text: "Air Fryer 5L Mondial",
        priceCents: 12900,
        store: "amazon",
        postedAt: "2026-08-01T12:00:00Z",
        url: "https://t.me/x/1",
      },
    ],
  };

  it("mostra contagem, mínimo e mediana", () => {
    const s = formatSearch(base);
    expect(s).toContain("41");
    expect(s).toContain("R$ 129,00");
    expect(s).toContain("R$ 297,00");
  });

  it("escapa HTML vindo do texto do post", () => {
    const s = formatSearch({
      ...base,
      melhores: [{ ...base.melhores[0], text: "TV <b>50</b> & mais" }],
    });
    expect(s).toContain("&lt;b&gt;");
    expect(s).not.toContain("<b>50</b>");
  });

  it("responde de forma útil quando não achou nada", () => {
    const s = formatSearch({ termo: "xyzabc", stats: null, melhores: [] });
    expect(s.toLowerCase()).toContain("não achei");
    expect(s).toContain("xyzabc");
  });
});

describe("formatAjuda", () => {
  it("lista os comandos disponíveis", () => {
    const s = formatAjuda();
    for (const cmd of ["/agora", "/cacar", "/cacas", "/ajuda"]) expect(s).toContain(cmd);
  });

  it("deixa claro que serve para qualquer produto, não só celular", () => {
    const s = formatAjuda().toLowerCase();
    expect(s).toContain("qualquer produto");
    for (const cat of ["cozinha", "móveis", "academia"]) expect(s).toContain(cat);
  });

  it("explica que a mediana é a régua, não o menor preço", () => {
    expect(formatAjuda().toLowerCase()).toContain("mediana");
  });

  it("NÃO promete botão de pausar — só excluir existe", () => {
    expect(formatAjuda().toLowerCase()).not.toContain("pausar");
  });

  it("usa a janela real da busca, sem número escrito à mão", () => {
    expect(formatAjuda()).toContain(`${MESES_PADRAO} meses`);
  });
});
