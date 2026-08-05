import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseChannelPage } from "@/lib/collector/parse";

const fixture = (name: string) => readFileSync(resolve(__dirname, "../fixtures", name), "utf8");

describe("parseChannelPage", () => {
  it("extrai os posts da página do CT Ofertas", () => {
    const posts = parseChannelPage(fixture("ctofertascelulares.html"), "ctofertascelulares");
    expect(posts.length).toBeGreaterThanOrEqual(15);

    for (const p of posts) {
      expect(p.postId).toBeGreaterThan(0);
      expect(p.url).toBe(`https://t.me/ctofertascelulares/${p.postId}`);
      expect(new Date(p.postedAt).toString()).not.toBe("Invalid Date");
      expect(p.text.length).toBeGreaterThan(0);
    }
  });

  it("devolve os posts em ordem crescente de postId, sem repetir", () => {
    const posts = parseChannelPage(fixture("gtOFERTAS.html"), "gtOFERTAS");
    const ids = posts.map((p) => p.postId);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("preenche preço em pelo menos metade dos posts de um canal de ofertas", () => {
    const posts = parseChannelPage(fixture("gtOFERTAS.html"), "gtOFERTAS");
    const comPreco = posts.filter((p) => p.priceCents !== null);
    expect(comPreco.length).toBeGreaterThanOrEqual(Math.floor(posts.length / 2));
  });

  it("preenche loja mesmo no canal que só usa encurtador próprio", () => {
    const posts = parseChannelPage(fixture("ctofertascelulares.html"), "ctofertascelulares");
    expect(posts.some((p) => p.store !== null)).toBe(true);
  });

  it("devolve lista vazia para página sem mensagens", () => {
    expect(parseChannelPage(fixture("vazio.html"), "qualquer")).toEqual([]);
  });
});
