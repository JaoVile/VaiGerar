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

/**
 * Página mínima com N posts, cada um com `datetime` e texto controlados.
 * Serve pra exercitar as guardas sem depender de uma fixture real conter um
 * post estragado — que é justamente o que nunca acontece de propósito.
 */
function paginaComPosts(posts: Array<{ id: number; datetime: string; texto: string }>): string {
  return posts
    .map(
      (p) => `<div class="tgme_widget_message" data-post="canal/${p.id}">
<div class="tgme_widget_message_text js-message_text">${p.texto}</div>
<time datetime="${p.datetime}"></time>
</div>`,
    )
    .join("\n");
}

const OK = "2026-08-12T12:00:00+00:00";

describe("parseChannelPage — guardas que protegem o lote", () => {
  // As duas guardas abaixo existiam sem nenhuma fixture as exercitando: a
  // garantia vinha só da leitura do código. Estão registradas em
  // docs/FOLLOW-UPS.md como dívida justamente por isso.
  //
  // O custo de a guarda falhar não é perder um post: `savePosts` grava em
  // lote, então uma linha venenosa derruba a gravação inteira. No backfill,
  // que reprocessa a mesma página, o dano é permanente — o canal para de
  // recuar para sempre.
  it("post com datetime malformado é pulado, e os vizinhos sobrevivem", () => {
    const html = paginaComPosts([
      { id: 1, datetime: OK, texto: "Air Fryer por R$ 299,00" },
      { id: 2, datetime: "ontem de tarde", texto: "TV 50 por R$ 1.999,00" },
      { id: 3, datetime: OK, texto: "Notebook por R$ 2.499,00" },
    ]);
    const posts = parseChannelPage(html, "canal");

    expect(posts.map((p) => p.postId)).toEqual([1, 3]);
    for (const p of posts) {
      expect(new Date(p.postedAt).toString()).not.toBe("Invalid Date");
    }
  });

  it("datetime vazio não vira data de 1970 nem lança", () => {
    const html = paginaComPosts([
      { id: 1, datetime: "", texto: "Air Fryer por R$ 299,00" },
      { id: 2, datetime: OK, texto: "TV por R$ 1.999,00" },
    ]);
    expect(() => parseChannelPage(html, "canal")).not.toThrow();
    expect(parseChannelPage(html, "canal").map((p) => p.postId)).toEqual([2]);
  });

  // MAX_PRICE_CENTS é R$ 5.000.000,00. Um anúncio com número absurdo (erro de
  // digitação, ou um código que parece dinheiro) não pode virar preço: ele
  // entraria na mediana e desregularia a régua do sistema inteiro.
  it("preço acima do teto plausível não é gravado como preço", () => {
    const html = paginaComPosts([
      { id: 1, datetime: OK, texto: "Casa na praia por R$ 9.999.999,00" },
    ]);
    const posts = parseChannelPage(html, "canal");

    expect(posts).toHaveLength(1);
    expect(posts[0].priceCents).toBeNull();
  });

  it("preço abaixo do piso plausível não é gravado como preço", () => {
    const html = paginaComPosts([{ id: 1, datetime: OK, texto: "Leve por R$ 0,50" }]);
    expect(parseChannelPage(html, "canal")[0].priceCents).toBeNull();
  });

  // O post continua sendo gravado — só sem preço. Descartar o post inteiro
  // perderia o texto, que ainda serve para busca.
  it("post com preço implausível ainda entra no arquivo, sem preço", () => {
    const html = paginaComPosts([
      { id: 1, datetime: OK, texto: "Mansão por R$ 90.000.000,00 imperdível" },
    ]);
    const posts = parseChannelPage(html, "canal");

    expect(posts[0].text).toContain("Mansão");
    expect(posts[0].priceCents).toBeNull();
  });
});

describe("parseChannelPage — foto do anúncio", () => {
  // Medido em 100 posts de 5 canais: 98% têm foto. As duas fixtures reais
  // deste repositório têm 20 wrappers de foto cada.
  it("extrai a URL da foto dos posts reais", () => {
    const posts = parseChannelPage(fixture("gtOFERTAS.html"), "gtOFERTAS");
    const comFoto = posts.filter((p) => p.photoUrl !== null);

    expect(comFoto.length).toBeGreaterThanOrEqual(posts.length / 2);
    for (const p of comFoto) {
      expect(p.photoUrl).toMatch(/^https:\/\/cdn\d*\.telesco\.pe\/file\//);
    }
  });

  it("a mesma foto não é repetida em posts diferentes", () => {
    // A foto sai do `chunk` do post, não da página inteira. Se saísse da
    // página, todos os posts levariam a primeira imagem.
    const posts = parseChannelPage(fixture("ctofertascelulares.html"), "ctofertascelulares");
    const urls = posts.map((p) => p.photoUrl).filter((u): u is string => u !== null);

    expect(new Set(urls).size).toBe(urls.length);
  });

  it("post sem foto fica com null, não com string vazia", () => {
    const html = paginaComPosts([{ id: 1, datetime: OK, texto: "Air Fryer por R$ 299,00" }]);
    expect(parseChannelPage(html, "canal")[0].photoUrl).toBeNull();
  });
});
