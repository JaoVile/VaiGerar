import { describe, expect, it } from "vitest";
import {
  formatAjuda,
  formatBRL,
  formatCacas,
  formatSearch,
  formatSearchPagina,
} from "@/lib/bot/format";
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

describe("formatSearchPagina", () => {
  const hit = (p: number) => ({
    text: `Produto ${p}`,
    priceCents: p,
    store: "amazon",
    postedAt: "2026-08-01T12:00:00Z",
    url: `https://t.me/x/${p}`,
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
