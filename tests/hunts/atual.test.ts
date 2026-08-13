import { describe, expect, it } from "vitest";
import { formatBRL, formatMenorAtual } from "@/lib/bot/format";
import { menorAtualPorCaca } from "@/lib/hunts/atual";
import { argsDe, createQueryFake } from "@/tests/helpers/fake-db";

const AGORA = new Date("2026-08-12T12:00:00Z");

const huntRow = (over: Record<string, unknown> = {}) => ({
  id: "h1",
  label: "Galaxy S25 Plus",
  query: "galaxy s25 plus",
  terms_any: ["s25+", "s25 plus"],
  terms_none: ["capa", "cabo"],
  price_min_cents: 285000,
  price_max_cents: 315000,
  ...over,
});

const postRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  text: "Samsung Galaxy S25 Plus 256GB",
  price_cents: 300000,
  store: "amazon",
  url: "https://t.me/x/1",
  posted_at: "2026-08-12T09:00:00Z",
  ...over,
});

describe("menorAtualPorCaca", () => {
  // O ponto inteiro do botão: o /cacas mostrava o menor do arquivo de 3 meses,
  // que pode ser oferta encerrada há semanas. Aqui a janela é a MESMA do motor
  // de alerta, então o que aparece é o que de fato dispararia.
  it("olha a mesma janela do alerta, não os 3 meses do arquivo", async () => {
    const db = createQueryFake({
      select: { hunts: [huntRow()], posts: [postRow()] },
    });
    await menorAtualPorCaca(db.client, 7, AGORA);

    const [coluna, valor] = argsDe(db.de("select", "posts")[0], "gte") as [string, string];
    expect(coluna).toBe("posted_at");
    const horas = (AGORA.getTime() - new Date(valor).getTime()) / 3_600_000;
    expect(horas).toBe(48);
  });

  it("uma consulta de posts só, mesmo com várias caças", async () => {
    // Seis caças fariam seis varreduras de 48h se cada uma consultasse sozinha.
    // O casamento é client-side justamente pra pagar uma leitura só.
    const db = createQueryFake({
      select: {
        hunts: [huntRow(), huntRow({ id: "h2", label: "Galaxy S26" })],
        posts: [postRow()],
      },
    });
    await menorAtualPorCaca(db.client, 7, AGORA);

    expect(db.de("select", "posts")).toHaveLength(1);
  });

  it("devolve o mais barato que casa, não o primeiro", async () => {
    const db = createQueryFake({
      select: {
        hunts: [huntRow()],
        posts: [
          postRow({ id: 1, price_cents: 310000, url: "https://t.me/x/caro" }),
          postRow({ id: 2, price_cents: 290000, url: "https://t.me/x/barato" }),
        ],
      },
    });
    const r = await menorAtualPorCaca(db.client, 7, AGORA);

    expect(r[0].achado?.priceCents).toBe(290000);
    expect(r[0].achado?.url).toBe("https://t.me/x/barato");
  });

  // Mesmo critério do alerta: fora da faixa não conta. Sem isto o botão diria
  // "achei por R$ 2.000" para uma capa de celular.
  it("respeita a faixa da caça", async () => {
    const db = createQueryFake({
      select: {
        hunts: [huntRow()],
        posts: [postRow({ price_cents: 100000 })],
      },
    });
    const r = await menorAtualPorCaca(db.client, 7, AGORA);
    expect(r[0].achado).toBeNull();
  });

  it("respeita a lista de palavras proibidas da caça", async () => {
    const db = createQueryFake({
      select: {
        hunts: [huntRow()],
        posts: [postRow({ text: "Capa para Galaxy S25 Plus premium" })],
      },
    });
    const r = await menorAtualPorCaca(db.client, 7, AGORA);
    expect(r[0].achado).toBeNull();
  });

  // O casamento por token de 12/08 vale aqui também: o botão não pode dizer
  // que achou um S25 Plus quando o post é de um S25 Ultra.
  it("não casa o modelo superior", async () => {
    const db = createQueryFake({
      select: {
        hunts: [huntRow({ terms_any: ["galaxy s25"] })],
        posts: [postRow({ text: "Samsung Galaxy S25 Ultra 512GB" })],
      },
    });
    const r = await menorAtualPorCaca(db.client, 7, AGORA);
    expect(r[0].achado).toBeNull();
  });

  it("caça sem nada na janela devolve null, não some da lista", async () => {
    const db = createQueryFake({
      select: {
        hunts: [huntRow(), huntRow({ id: "h2", label: "Galaxy S26", terms_any: ["s26"] })],
        posts: [postRow()],
      },
    });
    const r = await menorAtualPorCaca(db.client, 7, AGORA);

    expect(r).toHaveLength(2);
    expect(r[1].achado).toBeNull();
  });
});

describe("formatMenorAtual", () => {
  const caca = {
    label: "Galaxy S25 Plus",
    priceMinCents: 285000,
    priceMaxCents: 315000,
  };

  it("mostra preço, loja e link do que está de pé", () => {
    const s = formatMenorAtual(
      [
        {
          ...caca,
          achado: {
            priceCents: 290000,
            store: "amazon",
            url: "https://t.me/x/1",
            text: "Samsung Galaxy S25 Plus 256GB",
            postedAt: "2026-08-12T09:00:00Z",
            productUrl: "https://amzn.to/abc",
          },
        },
      ],
      AGORA,
    );
    expect(s).toContain("R$ 2.900,00");
    expect(s).toContain("amazon");
    expect(s).toContain("https://amzn.to/abc");
    expect(s).toContain("Galaxy S25 Plus 256GB");
  });

  // Sem isto o usuário não sabe se o botão está quebrado ou se realmente não
  // tem nada — e a diferença muda o que ele faz em seguida.
  it("caça sem oferta diz que a janela está vazia, não fica em branco", () => {
    const s = formatMenorAtual([{ ...caca, achado: null }], AGORA);
    expect(s).toContain("Galaxy S25 Plus");
    // Frase da LINHA DA CAÇA, não a do rodapé. A primeira versão deste teste
    // procurava só "nada", que o rodapé também contém — e continuava verde com
    // a linha da caça apagada. Verificado por mutação.
    expect(s).toContain("nada na sua faixa");
    expect(s).toContain(formatBRL(caca.priceMinCents));
  });

  it("diz a janela em horas pra ninguém achar que é o arquivo inteiro", () => {
    const s = formatMenorAtual([{ ...caca, achado: null }], AGORA);
    expect(s).toContain("48h");
  });

  it("sem caça nenhuma não devolve mensagem vazia", () => {
    expect(formatMenorAtual([], AGORA).length).toBeGreaterThan(10);
  });
});
