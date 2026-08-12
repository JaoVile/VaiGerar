import { describe, expect, it } from "vitest";
import {
  formatAjuda,
  formatBRL,
  formatCacas,
  formatSearch,
  formatSearchPagina,
  tituloDoPost,
} from "@/lib/bot/format";
import { MESES_PADRAO } from "@/lib/search/query";
import { escapeHtml } from "@/lib/telegram";

describe("tituloDoPost", () => {
  // Formato real dos canais: abrem o post com uma linha só de emoji
  // (🚨🚨, 😱😱, 🔥🔥) e o nome do produto vem só umas linhas depois.
  // Medido contra 2.400 posts reais em 2026-08-11: "primeira linha
  // não-vazia" dava título ruim em 19,3% dos casos; "linha mais longa sem
  // URL" zera essa taxa.
  it("post abre com linha de emoji: pega o nome do produto, não o emoji", () => {
    const texto = "🚨🚨\n\nSamsung Galaxy S25 Plus 256GB 12GB RAM 5G";
    expect(tituloDoPost(texto)).toBe("Samsung Galaxy S25 Plus 256GB 12GB RAM 5G");
  });

  it("nome do produto na terceira linha, não na primeira nem na segunda", () => {
    const texto = ["😱😱", "Corre que acaba rápido!!", "Air Fryer Mondial 5L Inox 220V"].join("\n");
    expect(tituloDoPost(texto)).toBe("Air Fryer Mondial 5L Inox 220V");
  });

  it("linha longa com URL não vira título — a URL some do resultado", () => {
    const texto = [
      "🔥🔥",
      "https://www.amazon.com.br/produto-incrivel-com-nome-longo-no-link/dp/B0ABCDEFGH",
      "TV Samsung 50 polegadas",
    ].join("\n");
    const titulo = tituloDoPost(texto);
    expect(titulo).toBe("TV Samsung 50 polegadas");
    expect(titulo).not.toContain("http");
  });

  it("post sem nenhuma linha útil (só emoji) cai no comportamento antigo em vez de vazio", () => {
    const texto = "🚨🚨\n😱😱\n🔥🔥";
    expect(tituloDoPost(texto)).toBe("🚨🚨");
  });

  it("post sem texto nenhum não lança e não devolve vazio às cegas", () => {
    expect(() => tituloDoPost("")).not.toThrow();
  });

  // Regressão descoberta em 12/08 ao provar o alerta em produção (item 1 do
  // PLANO-MELHORIAS): o alerta chegou com "_*Promoção sujeita a alteração a
  // qualquer momento_" como título. É o rodapé de aviso do canal
  // `ofertasrelampago`, e ele venceu o nome do produto por 3 caracteres
  // (41 alfanuméricos contra 38).
  //
  // Medido sobre 8.000 posts reais, avaliando numa metade a lista derivada da
  // outra (evita o número circular de filtrar e medir com a mesma lista):
  //
  //   critério                                    título boilerplate
  //   linha mais longa sem URL (o que estava no ar)         16,2%
  //   só linhas antes do link de compra                      9,7%
  //   antes do link + padrão de texto                        4,3%
  //
  // Ou seja: matar o emoji não bastou. A linha mais longa do post costuma ser
  // o aviso legal, não o produto.
  it("aviso legal mais longo que o nome do produto não vira título", () => {
    const texto = [
      "🚨GENTEE! 16L 😱🏃🏻‍♀️🏃🏻‍♀️",
      "Fritadeira Air Fryer Philco 16 Litros Paf16c",
      "🔥🔥por R$ 386,10",
      "🎟️Use o cupom: APROVEITAESSA",
      "👉Link p/ comprar: https://meli.la/2WTDW6M",
      "_*Promoção sujeita a alteração a qualquer momento_",
    ].join("\n");
    expect(tituloDoPost(texto)).toBe("Fritadeira Air Fryer Philco 16 Litros Paf16c");
  });

  it("linha depois do link de compra não vira título, mesmo sem casar padrão", () => {
    const texto = [
      "Monitor AOC 27 polegadas",
      "https://amzn.to/xyz",
      "Texto muito comprido de rodapé que o canal repete em todo post e que não descreve produto nenhum",
    ].join("\n");
    expect(tituloDoPost(texto)).toBe("Monitor AOC 27 polegadas");
  });

  it("post que só tem aviso legal antes do link cai no aviso em vez de vazio", () => {
    const texto = ["⚠️ Preço e estoque sujeitos a alteração.", "https://amzn.to/xyz"].join("\n");
    expect(tituloDoPost(texto)).toBe("⚠️ Preço e estoque sujeitos a alteração.");
  });

  // Post real do `nerdofertas` (12/08). Aqui o corte posicional NÃO resolve: a
  // linha de cupom vem antes do link de compra e é a mais longa do post (53
  // alfanuméricos contra 50 do nome do produto). Só REGEX_BOILERPLATE decide.
  //
  // Detalhe que faz a linha entrar como candidata: "s.shopee.com.br/..." vem
  // sem "https://", então REGEX_URL não a reconhece como URL.
  //
  // Este teste existe porque a primeira versão dos testes desta rodada passava
  // com a regex desativada — cobria só o corte posicional. É o padrão que já
  // apareceu 4x nesta base: teste verde sobre código sem prova.
  it("linha de cupom antes do link não vence o nome do produto", () => {
    const texto = [
      "➡️ Placa-Mãe AMD AM4 Asus TUF GAMING B550M-Plus - 90MB14A0-C1BAY0",
      "✅ R$ 647 😱😱",
      "🏷 Resgate todos os cupons desta página: s.shopee.com.br/9fK2leJqJZ",
      "🛒https://s.shopee.com.br/20u01rOneY",
    ].join("\n");
    expect(tituloDoPost(texto, 80)).toBe(
      "➡️ Placa-Mãe AMD AM4 Asus TUF GAMING B550M-Plus - 90MB14A0-C1BAY0",
    );
  });

  it("aviso de preço/estoque antes do link não vence o nome do produto", () => {
    const texto = [
      "📱 Poco M8 5G 256GB",
      "⚠️ Preço e estoque sujeitos a alteração a qualquer momento",
      "https://s.shopee.com.br/abc",
    ].join("\n");
    expect(tituloDoPost(texto)).toBe("📱 Poco M8 5G 256GB");
  });

  it("post sem link nenhum ainda escolhe a linha mais longa", () => {
    const texto = ["🔥", "Geladeira Brastemp Frost Free 375L"].join("\n");
    expect(tituloDoPost(texto)).toBe("Geladeira Brastemp Frost Free 375L");
  });

  it("trunca linha longa mantendo o limite de caracteres", () => {
    const texto = "P".repeat(100);
    const titulo = tituloDoPost(texto, 70);
    expect(titulo.length).toBe(71); // 70 + "…"
    expect(titulo.endsWith("…")).toBe(true);
  });
});

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
        productUrl: null,
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

  // Item 0 do plano: sem `product_url` o único link era o do post do
  // Telegram — o usuário clicava, caía no post, e precisava clicar de novo
  // pra chegar na loja. Quando o coletor preencheu `product_url`, ele passa
  // a aparecer como um segundo link.
  it("sem product_url, mostra só o link do post", () => {
    const s = formatSearch(base);
    expect(s).toContain('<a href="https://t.me/x/1">');
    expect(s).not.toContain("ir para a oferta");
  });

  it("com product_url, mostra os dois links", () => {
    const s = formatSearch({
      ...base,
      melhores: [{ ...base.melhores[0], productUrl: "https://loja.exemplo/produto" }],
    });
    expect(s).toContain('<a href="https://t.me/x/1">');
    expect(s).toContain('<a href="https://loja.exemplo/produto">ir para a oferta</a>');
  });

  // `product_url` em canais como o `ctofertascelulares` é um encurtador do
  // próprio canal (`canalte.ch`), não a loja de verdade — não dá pra
  // prometer "loja" no rótulo.
  it("não promete 'loja' no rótulo do link de product_url — é 'oferta', neutro", () => {
    const s = formatSearch({
      ...base,
      melhores: [{ ...base.melhores[0], productUrl: "https://canalte.ch/xyz" }],
    });
    expect(s.toLowerCase()).not.toContain("ir para a loja");
    expect(s).toContain("ir para a oferta");
  });

  it("escapa HTML do product_url dentro do href", () => {
    const s = formatSearch({
      ...base,
      melhores: [{ ...base.melhores[0], productUrl: "https://loja.exemplo/x?a=1&b=2" }],
    });
    expect(s).toContain("https://loja.exemplo/x?a=1&amp;b=2");
    expect(s).not.toContain("x?a=1&b=2");
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

describe("formatSearchPagina", () => {
  const hit = (p: number) => ({
    text: `Produto ${p}`,
    priceCents: p,
    store: "amazon",
    postedAt: "2026-08-01T12:00:00Z",
    url: `https://t.me/x/${p}`,
    productUrl: null,
  });
  const r = {
    termo: "air fryer",
    stats: { count: 12, minCents: 100, medianCents: 500, maxCents: 900 },
    melhores: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200].map(hit),
  };

  it("mostra só a fatia da página pedida", () => {
    const p = formatSearchPagina(r, 0, 5);
    expect(p.texto).toContain("Produto 100");
    expect(p.texto).not.toContain("Produto 600");
  });

  it("indica a posição na contagem total", () => {
    expect(formatSearchPagina(r, 5, 5).texto).toContain("6");
    expect(formatSearchPagina(r, 5, 5).texto).toContain("12");
  });

  it("na primeira página oferece só avançar", () => {
    const cbs =
      formatSearchPagina(r, 0, 5)
        .keyboard?.inline_keyboard.flat()
        .map((b) => b.callback_data) ?? [];
    expect(cbs).toContain("pag:5");
    expect(cbs.some((c) => c === "pag:-5")).toBe(false);
  });

  it("no meio oferece voltar e avançar", () => {
    const cbs =
      formatSearchPagina(r, 5, 5)
        .keyboard?.inline_keyboard.flat()
        .map((b) => b.callback_data) ?? [];
    expect(cbs).toContain("pag:0");
    expect(cbs).toContain("pag:10");
  });

  it("na última página não oferece avançar", () => {
    const cbs =
      formatSearchPagina(r, 10, 5)
        .keyboard?.inline_keyboard.flat()
        .map((b) => b.callback_data) ?? [];
    expect(cbs).toContain("pag:5");
    expect(cbs.some((c) => c === "pag:15")).toBe(false);
  });

  it("sem resultados não oferece botão nenhum", () => {
    const vazio = { termo: "xyz", stats: null, melhores: [] };
    expect(formatSearchPagina(vazio, 0, 5).keyboard).toBeUndefined();
  });

  it("todo callback_data cabe em 64 bytes", () => {
    for (const off of [0, 5, 10]) {
      for (const b of formatSearchPagina(r, off, 5).keyboard?.inline_keyboard.flat() ?? []) {
        expect(Buffer.byteLength(b.callback_data, "utf8")).toBeLessThanOrEqual(64);
      }
    }
  });
});

describe("formatCacas", () => {
  const base = {
    label: "Galaxy S25 Plus",
    priceMinCents: 270000,
    priceMaxCents: 330000,
    melhorAtualCents: 351912,
    medianaCents: 396800,
  };

  it("mostra a faixa pedida", () => {
    const s = formatCacas([base]);
    expect(s).toContain(formatBRL(270000));
    expect(s).toContain(formatBRL(330000));
  });

  it("mostra o melhor preço do arquivo e quanto falta cair", () => {
    const s = formatCacas([base]);
    expect(s).toContain(formatBRL(351912));
    // 351912 contra teto 330000 → 7% acima
    expect(s).toMatch(/7%/);
  });

  // O preço vem de `buscar`, que lê a janela de MESES_PADRAO meses — não o que
  // está de pé agora. Chamar isso de "melhor agora" fazia o usuário esperar por
  // um alerta que nunca vem (o alerta só olha post recente).
  it("rotula o preço com a janela de busca, não como preço de agora", () => {
    const s = formatCacas([base]);
    expect(s).toContain(`melhor em ${MESES_PADRAO} meses`);
    expect(s).not.toContain("melhor agora");
  });

  it("avisa que o preço na faixa é do arquivo, não uma oferta viva agora", () => {
    const s = formatCacas([{ ...base, melhorAtualCents: 320000 }]);
    expect(s.toLowerCase()).toContain("já apareceu na sua faixa");
    // A ressalva tem que estar na mensagem, senão "na faixa" se lê como
    // "está disponível agora por esse preço".
    expect(s.toLowerCase()).toMatch(/oferta já encerrada|reaparecer/);
  });

  // `casa()` rejeita preço abaixo do piso — o piso existe pra acessório não
  // disparar alerta. Imprimir esse preço como "na faixa" fazia a listagem e o
  // motor de alerta discordarem sobre a mesma pergunta.
  it("não chama de faixa um preço abaixo do piso, e diz por quê", () => {
    const s = formatCacas([{ ...base, melhorAtualCents: 250000 }]);
    expect(s).toContain(formatBRL(250000));
    expect(s.toLowerCase()).not.toContain("já apareceu na sua faixa");
    expect(s.toLowerCase()).toContain("abaixo do seu piso");
    expect(s.toLowerCase()).toMatch(/barato demais|acessório/);
  });

  // Entre +0,01% e +0,49% o arredondamento dava "0% acima do seu teto", que se
  // lê como contradição.
  it("não imprime 0% para preço logo acima do teto", () => {
    const s = formatCacas([{ ...base, melhorAtualCents: 330500 }]);
    expect(s).not.toContain("0% acima");
    expect(s.toLowerCase()).toContain("logo acima do seu teto");
  });

  it("lida com caça sem nenhuma oferta conhecida", () => {
    const s = formatCacas([{ ...base, melhorAtualCents: null, medianaCents: null }]);
    expect(s.toLowerCase()).toContain("nenhuma oferta");
  });

  it("escapa o rótulo do usuário", () => {
    const s = formatCacas([{ ...base, label: "tv <50 & cia" }]);
    expect(s).toContain("&lt;50");
    expect(s).not.toContain("<50 &");
  });
});
