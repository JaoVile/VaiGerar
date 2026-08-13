import { describe, expect, it } from "vitest";
import { formatCupons } from "@/lib/bot/format";
import {
  buscarCupons,
  DIAS_COM_PRODUTO,
  DIAS_PADRAO,
  normalizarLoja,
  separarLojaProduto,
} from "@/lib/search/coupons";
import { argsDe, createQueryFake } from "@/tests/helpers/fake-db";

describe("normalizarLoja", () => {
  // `posts.store` guarda o slug técnico. Sem os apelidos, "/cupom mercado
  // livre" — que é como a loja se chama — não acharia nada, e o usuário
  // concluiria que não existe cupom, não que digitou o nome "errado".
  it("resolve os apelidos da mesma loja para um slug só", () => {
    expect(normalizarLoja("mercado livre")).toBe("mercadolivre");
    expect(normalizarLoja("ML")).toBe("mercadolivre");
    expect(normalizarLoja("meli")).toBe("mercadolivre");
    expect(normalizarLoja("Magazine Luiza")).toBe("magalu");
  });

  it("ignora acento e caixa", () => {
    expect(normalizarLoja("  AmaZon ")).toBe("amazon");
  });

  it("loja desconhecida passa direto em vez de virar null", () => {
    // Vira uma consulta que não casa nada, e o formato explica. Melhor que
    // buscar em todas as lojas silenciosamente quando o usuário pediu uma.
    expect(normalizarLoja("lojinha do zé")).toBe("lojinha do ze");
  });
});

const post = (over: Record<string, unknown> = {}) => ({
  text: "🎟️Use o cupom: APROVEITAESSA",
  store: "amazon",
  posted_at: "2026-08-12T10:00:00Z",
  url: "https://t.me/x/1",
  ...over,
});

describe("buscarCupons", () => {
  it("filtra pela loja normalizada, não pelo que o usuário digitou", async () => {
    const db = createQueryFake({ select: { posts: [post()] } });
    await buscarCupons(db.client, "mercado livre");

    expect(argsDe(db.de("select", "posts")[0], "eq")).toEqual(["store", "mercadolivre"]);
  });

  // `COMPRINHASPRACASA` aparece 146 vezes no arquivo real. Sem dedup a
  // primeira tela do /cupom seria o mesmo código repetido dezenas de vezes.
  it("devolve cada código uma vez, na ocorrência mais recente", async () => {
    const db = createQueryFake({
      select: {
        posts: [
          // O mais RECENTE vem primeiro de propósito. Com a ordem invertida
          // este teste passava sem a comparação de data, só porque o `Map`
          // sobrescrevia na ordem certa por acaso — verificado por mutação.
          post({
            posted_at: "2026-08-12T10:00:00Z",
            url: "https://t.me/x/novo",
          }),
          post({
            posted_at: "2026-08-10T10:00:00Z",
            url: "https://t.me/x/velho",
          }),
        ],
      },
    });
    const r = await buscarCupons(db.client, "amazon");

    expect(r.cupons).toHaveLength(1);
    expect(r.cupons[0].url).toBe("https://t.me/x/novo");
  });

  it("ordena do mais recente para o mais antigo", async () => {
    const db = createQueryFake({
      select: {
        posts: [
          post({ text: "cupom: VELHO123", posted_at: "2026-08-09T10:00:00Z" }),
          post({ text: "cupom: NOVO456", posted_at: "2026-08-12T10:00:00Z" }),
        ],
      },
    });
    const r = await buscarCupons(db.client, "amazon");

    expect(r.cupons.map((c) => c.codigo)).toEqual(["NOVO456", "VELHO123"]);
  });

  it("post sem cupom nenhum não vira linha vazia no resultado", async () => {
    const db = createQueryFake({
      select: { posts: [post({ text: "Galaxy S25+ por R$ 2.899,00" })] },
    });
    const r = await buscarCupons(db.client, "amazon");

    expect(r.cupons).toEqual([]);
  });

  it("aplica a janela de dias na consulta", async () => {
    const db = createQueryFake({ select: { posts: [] } });
    await buscarCupons(db.client, "amazon", { dias: 1 });

    const [coluna, valor] = argsDe(db.de("select", "posts")[0], "gte") as [string, string];
    expect(coluna).toBe("posted_at");
    const horas = (Date.now() - new Date(valor).getTime()) / 3_600_000;
    expect(horas).toBeGreaterThan(23);
    expect(horas).toBeLessThan(25);
  });
});

describe("formatCupons", () => {
  const agora = new Date("2026-08-12T12:00:00Z");

  it("mostra o código em bloco de código, pra dar pra copiar", () => {
    const s = formatCupons(
      {
        loja: "amazon",
        produto: null,
        dias: 3,
        cupons: [
          {
            codigo: "APROVEITAESSA",
            descontoTexto: null,
            pisoCents: null,
            tetoCents: null,
            beneficios: [],
            restricoes: [],
            store: "amazon",
            postedAt: "2026-08-12T10:00:00Z",
            url: "https://t.me/x/1",
          },
        ],
      },
      agora,
    );
    expect(s).toContain("<code>APROVEITAESSA</code>");
    expect(s).toContain("Amazon");
  });

  // Validade é impossível de saber pelo post. Dizer a idade é o mais honesto
  // que dá — e evita o usuário culpar o bot por um cupom morto.
  it("diz a idade de cada cupom em vez de fingir que está ativo", () => {
    const base = {
      descontoTexto: null,
      pisoCents: null,
      tetoCents: null,
      beneficios: [],
      restricoes: [],
      store: "amazon",
      url: "https://t.me/x/1",
    };
    const s = formatCupons(
      {
        loja: "amazon",
        produto: null,
        dias: 3,
        cupons: [
          { ...base, codigo: "DEHOJE", postedAt: "2026-08-12T09:00:00Z" },
          { ...base, codigo: "DEONTEM", postedAt: "2026-08-11T09:00:00Z" },
          { ...base, codigo: "DEANTES", postedAt: "2026-08-09T09:00:00Z" },
        ],
      },
      agora,
    );
    expect(s).toContain("hoje");
    expect(s).toContain("ontem");
    expect(s).toContain("há 3 dias");
    expect(s.toLowerCase()).toContain("não a validade");
  });

  it("mostra desconto e piso quando o post trouxe", () => {
    const s = formatCupons(
      {
        loja: "amazon",
        produto: null,
        dias: 3,
        cupons: [
          {
            codigo: "NOTE400",
            descontoTexto: "R$400 OFF",
            pisoCents: 20000,
            tetoCents: null,
            beneficios: [],
            restricoes: [],
            store: "amazon",
            postedAt: "2026-08-12T09:00:00Z",
            url: "https://t.me/x/1",
          },
        ],
      },
      agora,
    );
    expect(s).toContain("R$400 OFF");
    expect(s).toContain("R$ 200,00");
  });

  it("lista vazia sugere as lojas que têm cupom, em vez de só dizer não", () => {
    const s = formatCupons({ loja: "lojinha", produto: null, dias: 3, cupons: [] }, agora);
    expect(s).toContain("amazon");
    expect(s).toContain("mercado livre");
  });
});

describe("formatCupons — benefício e restrição", () => {
  const agora = new Date("2026-08-12T12:00:00Z");
  const base = {
    codigo: "MARCOU",
    store: "mercadolivre",
    postedAt: "2026-08-12T09:00:00Z",
    url: "https://t.me/x/1",
    descontoTexto: null as string | null,
    pisoCents: null as number | null,
    tetoCents: null as number | null,
    beneficios: [] as string[],
    restricoes: [] as string[],
  };
  const render = (over: Partial<typeof base>) =>
    formatCupons(
      { loja: "mercadolivre", produto: null, dias: 3, cupons: [{ ...base, ...over }] },
      agora,
    );

  // Post real: "10% OFF em compras acima de R$129, limite de R$40".
  it("separa o que o cupom dá do que ele exige", () => {
    const s = render({ descontoTexto: "10%", pisoCents: 12900, tetoCents: 4000 });
    expect(s).toContain("no máximo R$ 40,00");
    expect(s).toContain("compra acima de R$ 129,00");
  });

  it("mostra as restrições do post", () => {
    const s = render({ restricoes: ["1 uso por CPF", "itens selecionados"] });
    expect(s).toContain("1 uso por CPF");
    expect(s).toContain("itens selecionados");
  });

  it("frete grátis aparece como ganho, não como exigência", () => {
    const s = render({ beneficios: ["frete grátis"] });
    const linha = s.split("\n").find((l) => l.includes("frete grátis")) ?? "";
    expect(linha).toContain("MARCOU");
    expect(linha).not.toContain("⚠️");
  });

  // Medido: ~80% dos posts com cupom só trazem o código. Sem esta linha o
  // usuário supõe "sem restrição" e toma recusa no caixa.
  it("cupom sem nenhuma regra declarada avisa que o post não diz", () => {
    expect(render({}).toLowerCase()).toContain("não diz as regras");
  });

  it("cupom com regra não recebe o aviso de post omisso", () => {
    expect(render({ pisoCents: 12900 }).toLowerCase()).not.toContain("não diz as regras");
  });
});

describe("separarLojaProduto", () => {
  // Várias lojas têm nome de duas palavras. Cortar no primeiro espaço
  // transformaria metade da loja em produto e a busca não acharia nada.
  it("corta no maior prefixo que é loja conhecida", () => {
    expect(separarLojaProduto("mercado livre ducha")).toEqual({
      loja: "mercado livre",
      produto: "ducha",
    });
    expect(separarLojaProduto("magazine luiza tv 50")).toEqual({
      loja: "magazine luiza",
      produto: "tv 50",
    });
  });

  it("loja de uma palavra também funciona", () => {
    expect(separarLojaProduto("amazon notebook")).toEqual({
      loja: "amazon",
      produto: "notebook",
    });
  });

  it("só a loja continua sem produto", () => {
    expect(separarLojaProduto("mercado livre")).toEqual({
      loja: "mercado livre",
      produto: null,
    });
  });

  it("apelido conta como loja conhecida", () => {
    expect(separarLojaProduto("meli fone bluetooth")).toEqual({
      loja: "meli",
      produto: "fone bluetooth",
    });
  });

  // Comportamento antigo preservado: sem loja conhecida, a entrada inteira é
  // a loja. Assim "/cupom lojinha do zé" responde "não achei cupom da lojinha
  // do zé" em vez de inventar que "do zé" é produto.
  it("entrada sem loja conhecida vira loja inteira, sem produto", () => {
    expect(separarLojaProduto("lojinha do zé")).toEqual({
      loja: "lojinha do zé",
      produto: null,
    });
  });
});

describe("buscarCupons com produto", () => {
  it("filtra por loja E por produto", async () => {
    const db = createQueryFake({ select: { posts: [post()] } });
    const r = await buscarCupons(db.client, "mercado livre ducha");

    const q = db.de("select", "posts")[0];
    expect(argsDe(q, "eq")).toEqual(["store", "mercadolivre"]);
    expect(argsDe(q, "textSearch")?.[0]).toBe("search_vector");
    expect(argsDe(q, "textSearch")?.[1]).toBe("ducha");
    expect(r.produto).toBe("ducha");
  });

  it("sem produto não manda textSearch", async () => {
    const db = createQueryFake({ select: { posts: [post()] } });
    await buscarCupons(db.client, "mercado livre");

    expect(argsDe(db.de("select", "posts")[0], "textSearch")).toBeUndefined();
  });

  // Medido em 13/08: "mercadolivre + ducha" rende 1 cupom em 3 dias, e
  // "amazon + monitor" vai de 2 para 22 ao abrir pra 7. Filtrar por produto
  // corta tanto que a janela curta só devolve vazio.
  it("com produto a janela abre para 7 dias", async () => {
    const db = createQueryFake({ select: { posts: [] } });
    const r = await buscarCupons(db.client, "amazon monitor");
    expect(r.dias).toBe(DIAS_COM_PRODUTO);
  });

  it("sem produto a janela segue em 3 dias", async () => {
    const db = createQueryFake({ select: { posts: [] } });
    expect((await buscarCupons(db.client, "amazon")).dias).toBe(DIAS_PADRAO);
  });

  it("dias explícito manda mais que o padrão dos dois modos", async () => {
    const db = createQueryFake({ select: { posts: [] } });
    expect((await buscarCupons(db.client, "amazon monitor", { dias: 1 })).dias).toBe(1);
  });
});

describe("formatCupons com produto", () => {
  const agora = new Date("2026-08-12T12:00:00Z");
  const cupom = {
    codigo: "DUCHA20",
    descontoTexto: "20%",
    pisoCents: null,
    tetoCents: null,
    beneficios: [],
    restricoes: [],
    store: "mercadolivre",
    postedAt: "2026-08-12T09:00:00Z",
    url: "https://t.me/x/1",
  };

  it("mostra loja e produto no cabeçalho", () => {
    const s = formatCupons(
      { loja: "mercadolivre", produto: "ducha", dias: 7, cupons: [cupom] },
      agora,
    );
    expect(s).toContain("Mercado Livre");
    expect(s).toContain("ducha");
  });

  // Sem esta ressalva o usuário lê "cupom de ducha" e supõe que o código só
  // vale pra ducha. O que o dado sustenta é bem mais fraco: o código apareceu
  // num post que falava de ducha.
  it("avisa que o cupom não é exclusivo do produto", () => {
    const s = formatCupons(
      { loja: "mercadolivre", produto: "ducha", dias: 7, cupons: [cupom] },
      agora,
    );
    expect(s.toLowerCase()).toContain("costuma valer para mais coisa");
  });

  // Duas causas possíveis pro vazio, e a saída é a mesma: tirar o produto.
  it("vazio com produto manda tentar sem o produto", () => {
    const s = formatCupons({ loja: "mercadolivre", produto: "ducha", dias: 7, cupons: [] }, agora);
    expect(s).toContain("ducha");
    expect(s).toContain("/cupom mercadolivre");
  });
});
