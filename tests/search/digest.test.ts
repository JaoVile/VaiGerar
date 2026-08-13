import { describe, expect, it } from "vitest";
import { formatResumo } from "@/lib/bot/format";
import { chaveDoProduto, resumoDoDia } from "@/lib/search/digest";
import { createQueryFake } from "@/tests/helpers/fake-db";

const AGORA = new Date("2026-08-12T18:00:00Z");
const hHoje = (h: number) => new Date(AGORA.getTime() - h * 3600 * 1000).toISOString();
const dAtras = (d: number) => new Date(AGORA.getTime() - d * 24 * 3600 * 1000).toISOString();

const canais = [
  { slug: "gtOFERTAS", kind: "tech" },
  { slug: "promocasinha", kind: "casa" },
  { slug: "promoimporta", kind: "china" },
];

const post = (over: Record<string, unknown> = {}) => ({
  text: "Mouse Gamer Sem Fio Redragon Invader Pro RGB",
  price_cents: 14900,
  posted_at: dAtras(5),
  store: "amazon",
  url: "https://t.me/x/1",
  product_url: null,
  channel_slug: "gtOFERTAS",
  ...over,
});

/** `n` anúncios do mesmo produto, no mesmo preço, espalhados no histórico. */
const historico = (n: number, price: number, over: Record<string, unknown> = {}) =>
  Array.from({ length: n }, (_, i) =>
    post({ price_cents: price, posted_at: dAtras(3 + i), ...over }),
  );

const cenario = (posts: Record<string, unknown>[]) =>
  createQueryFake({ select: { channels: canais, posts } });

describe("chaveDoProduto", () => {
  // A primeira versão disto reimplementou a escolha de título de forma ingênua
  // e agrupou "Pasta Térmica" com "Budweiser" — as duas caíam no mesmo rodapé
  // de canal, que era a linha mais longa. Usar `tituloDoPost` resolve.
  it("produtos diferentes com o mesmo rodapé não caem na mesma chave", () => {
    const rodape = "\n⚠️ Preço e estoque sujeitos a alteração.\nhttps://t.me/canal";
    const a = chaveDoProduto(`Pasta Térmica TS Cold 10,5 w/m-k 1g${rodape}`);
    const b = chaveDoProduto(`Pack 6 Garrafas Budweiser Long Neck 330ml${rodape}`);
    expect(a).not.toBe(b);
  });

  it("o mesmo produto anunciado com emoji diferente cai na mesma chave", () => {
    expect(chaveDoProduto("🔥Placa Mãe MSI B550M-A PRO DDR4 Socket AMD")).toBe(
      chaveDoProduto("➡️ Placa Mãe MSI B550M-A Pro DDR4 Socket AMD"),
    );
  });

  // Menos de 3 tokens significativos não identifica produto nenhum. "Oi tudo
  // bem" NÃO serve de exemplo: são exatamente 3 tokens e passa — a primeira
  // versão deste teste usava isso e falhou por eu ter contado errado.
  it("título curto demais não vira chave", () => {
    expect(chaveDoProduto("Preço de hoje")).toBeNull();
    expect(chaveDoProduto("🔥🔥🔥")).toBeNull();
  });
});

describe("resumoDoDia", () => {
  it("acha a oferta abaixo da mediana do próprio produto", async () => {
    const db = cenario([
      ...historico(4, 14900),
      post({
        price_cents: 9000,
        posted_at: hHoje(2),
        url: "https://t.me/x/hoje",
      }),
    ]);
    const r = await resumoDoDia(db.client, AGORA);

    expect(r.secoes).toHaveLength(1);
    expect(r.secoes[0].kind).toBe("tech");
    expect(r.secoes[0].achados[0].descontoPct).toBe(40);
    expect(r.secoes[0].achados[0].medianaCents).toBe(14900);
  });

  // Sem histórico não há régua. Um produto que aparece pela primeira vez pode
  // estar caro ou barato e não há como saber.
  it("produto sem histórico suficiente não entra", async () => {
    const db = cenario([...historico(2, 14900), post({ price_cents: 9000, posted_at: hHoje(2) })]);
    expect((await resumoDoDia(db.client, AGORA)).secoes).toEqual([]);
  });

  // O portão que mais trabalha: sem ele, uma linha de rodapé virava chave e
  // agrupava 325 anúncios sem relação nenhuma, com mediana inventada.
  it("grupo com preços dispersos não é produto — não entra", async () => {
    // O desconto de hoje cai DENTRO da banda de propósito (~20%): com preços
    // absurdos, a banda barraria antes e o portão de dispersão nunca seria
    // exercitado — foi o que aconteceu na primeira versão deste teste, que
    // continuava verde com o portão desligado.
    const espalhado = [10000, 15000, 60000, 90000].map((p, i) =>
      post({ price_cents: p, posted_at: dAtras(3 + i) }),
    );
    const db = cenario([...espalhado, post({ price_cents: 30000, posted_at: hHoje(2) })]);
    expect((await resumoDoDia(db.client, AGORA)).secoes).toEqual([]);
  });

  // Medido: ranquear por maior desconto trazia um monitor gamer a R$ 20 no
  // topo — erro de leitura de preço, não oferta.
  it("desconto absurdo é erro de parse, não achado", async () => {
    const db = cenario([...historico(4, 82400), post({ price_cents: 2000, posted_at: hHoje(2) })]);
    expect((await resumoDoDia(db.client, AGORA)).secoes).toEqual([]);
  });

  it("desconto pequeno é variação normal, não achado", async () => {
    const db = cenario([...historico(4, 10000), post({ price_cents: 9500, posted_at: hHoje(2) })]);
    expect((await resumoDoDia(db.client, AGORA)).secoes).toEqual([]);
  });

  it("post cujo título é regra de cupom não entra", async () => {
    const cupom = {
      text: "🏷 20% OFF em compras acima de R$19 - Limite de R$150",
    };
    const db = cenario([
      ...historico(4, 4000, cupom),
      post({ ...cupom, price_cents: 1900, posted_at: hHoje(2) }),
    ]);
    expect((await resumoDoDia(db.client, AGORA)).secoes).toEqual([]);
  });

  // O mesmo anúncio sai em vários canais; repetir a mesma placa-mãe quatro
  // vezes gastaria a lista inteira num produto só.
  it("mesmo produto em canais diferentes aparece uma vez, no menor preço", async () => {
    // O MAIS BARATO vem primeiro de propósito: com ele por último, o `Map`
    // acabaria com o valor certo mesmo sem a comparação de preço, e o teste
    // passava com o dedup desligado. Mesma armadilha do teste de cupons.
    const db = cenario([
      ...historico(4, 14900),
      post({
        price_cents: 9000,
        posted_at: hHoje(2),
        channel_slug: "promocasinha",
      }),
      post({ price_cents: 9500, posted_at: hHoje(3) }),
    ]);
    const r = await resumoDoDia(db.client, AGORA);
    const todos = r.secoes.flatMap((s) => s.achados);

    expect(todos).toHaveLength(1);
    expect(todos[0].priceCents).toBe(9000);
  });

  it("separa por seção e ignora as vazias", async () => {
    const db = cenario([
      ...historico(4, 14900),
      post({ price_cents: 9000, posted_at: hHoje(2) }),
      ...historico(4, 20000, {
        text: "Panela de Pressão Tramontina 4,5L",
        channel_slug: "promocasinha",
      }),
      post({
        text: "Panela de Pressão Tramontina 4,5L",
        price_cents: 14000,
        posted_at: hHoje(1),
        channel_slug: "promocasinha",
      }),
    ]);
    const r = await resumoDoDia(db.client, AGORA);

    expect(r.secoes.map((s) => s.kind)).toEqual(["tech", "casa"]);
    expect(r.secoes.every((s) => s.achados.length > 0)).toBe(true);
  });

  it("oferta de ontem não entra no resumo de hoje", async () => {
    const db = cenario([...historico(4, 14900), post({ price_cents: 9000, posted_at: hHoje(30) })]);
    expect((await resumoDoDia(db.client, AGORA)).secoes).toEqual([]);
  });
});

describe("formatResumo", () => {
  const achado = {
    titulo: "Mouse Gamer Redragon Invader Pro",
    priceCents: 9000,
    medianaCents: 14900,
    descontoPct: 40,
    amostra: 16,
    store: "amazon",
    url: "https://t.me/x/1",
    productUrl: "https://amzn.to/abc",
    kind: "tech",
  };

  it("mostra o desconto, o preço de hoje e o de antes", () => {
    const s = formatResumo(
      { secoes: [{ kind: "tech", achados: [achado] }], examinados: 1072 },
      AGORA,
    );
    expect(s).toContain("40%");
    expect(s).toContain("R$ 90,00");
    expect(s).toContain("R$ 149,00");
  });

  // Um desconto sustentado por 3 anúncios merece menos fé que um sustentado
  // por 58. Esconder a amostra venderia certeza que o dado não tem.
  it("mostra o tamanho da amostra que sustenta a mediana", () => {
    const s = formatResumo(
      { secoes: [{ kind: "tech", achados: [achado] }], examinados: 100 },
      AGORA,
    );
    expect(s).toContain("16 anúncios");
  });

  it("nomeia a seção em vez de mostrar o slug técnico", () => {
    const s = formatResumo(
      { secoes: [{ kind: "china", achados: [achado] }], examinados: 10 },
      AGORA,
    );
    expect(s).toContain("Importados");
    expect(s).not.toContain("china");
  });

  // Dia sem achado é resultado, não falha. Sem esta mensagem o usuário conclui
  // que o comando quebrou.
  it("dia sem achado explica o critério em vez de ficar em branco", () => {
    const s = formatResumo({ secoes: [], examinados: 1072 }, AGORA);
    expect(s).toContain("1072");
    expect(s.toLowerCase()).toContain("nenhuma");
  });
});
