import { describe, expect, it } from "vitest";
import { formatAlerta } from "@/lib/cron/alerts";

const hunt = {
  id: "h1",
  chatId: 7,
  label: "Galaxy S25+",
  termsAny: ["s25+"],
  termsNone: [],
  priceMinCents: 285000,
  priceMaxCents: 315000,
};

const post = {
  rowId: 1,
  text: "Galaxy S25+ 256GB\nPor R$ 2.899,00",
  priceCents: 289900,
  store: "amazon",
  url: "https://t.me/x/1",
  postedAt: "2026-08-10T15:00:00Z",
};

describe("formatAlerta", () => {
  it("mostra o rótulo da caça e o preço", () => {
    const s = formatAlerta(hunt, post);
    expect(s).toContain("Galaxy S25+");
    expect(s).toContain("R$ 2.899,00");
  });

  it("mostra a loja e o link do post", () => {
    const s = formatAlerta(hunt, post);
    expect(s).toContain("amazon");
    expect(s).toContain("https://t.me/x/1");
  });

  it("escapa HTML vindo do texto do post", () => {
    const s = formatAlerta(hunt, { ...post, text: "TV <b>50</b> & tal" });
    expect(s).toContain("&lt;b&gt;");
  });

  it("diz quanto está abaixo do teto da faixa", () => {
    // teto 315000, preço 289900 → 8% abaixo
    expect(formatAlerta(hunt, post)).toMatch(/8%/);
  });
});
