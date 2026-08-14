import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatBRL } from "@/lib/bot/format";
import { formatAlerta, processarAlertas } from "@/lib/cron/alerts";
import { TelegramRateLimitError } from "@/lib/telegram";
import { argsDe, createQueryFake, todasAsChamadas } from "@/tests/helpers/fake-db";

// Só o I/O do Telegram é mockado; `escapeHtml` e `TelegramRateLimitError`
// continuam reais.
const { sendMessageMock, sendPhotoMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
  sendPhotoMock: vi.fn(),
}));
vi.mock("@/lib/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/telegram")>()),
  sendMessage: sendMessageMock,
  sendPhoto: sendPhotoMock,
}));

const hunt = {
  id: "h1",
  chatId: 7,
  label: "Galaxy S25+",
  query: "s25 plus",
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
  productUrl: "https://amzn.to/abc",
  photoUrl: null,
  postedAt: "2026-08-10T15:00:00Z",
};

describe("formatAlerta", () => {
  // A reclamação que originou o item 0 ("apareceu o preço mas sem informação
  // de onde eu encontraria") valia igual pro alerta: ele mandava só o link do
  // post do Telegram. Em canal que encurta pelo domínio próprio
  // (`ctofertascelulares`, 100% dos posts) são dois saltos até o produto.
  it("inclui o link direto da oferta, além do link do post", () => {
    const s = formatAlerta(hunt, post, null);
    expect(s).toContain("https://amzn.to/abc");
    expect(s).toContain("ir para a oferta");
    expect(s).toContain("https://t.me/x/1");
  });

  it("post sem product_url não mostra linha de oferta quebrada", () => {
    const s = formatAlerta(hunt, { ...post, productUrl: null }, null);
    expect(s).not.toContain("ir para a oferta");
    expect(s).toContain("https://t.me/x/1");
  });

  it("mostra o rótulo da caça e o preço", () => {
    const s = formatAlerta(hunt, post, null);
    expect(s).toContain("Galaxy S25+");
    expect(s).toContain("R$ 2.899,00");
  });

  it("mostra a loja e o link do post", () => {
    const s = formatAlerta(hunt, post, null);
    expect(s).toContain("amazon");
    expect(s).toContain("https://t.me/x/1");
  });

  it("escapa HTML vindo do texto do post", () => {
    const s = formatAlerta(hunt, { ...post, text: "TV <b>50</b> & tal" }, null);
    expect(s).toContain("&lt;b&gt;");
  });

  it("mostra a data do post — oferta antiga tem que se denunciar", () => {
    // Sem a data, "R$ 2.899,00 — 8% abaixo do teto" parece oferta de agora
    // mesmo quando não é; o usuário só descobre clicando.
    expect(formatAlerta(hunt, post, null)).toContain("2026-08-10");
  });

  it("diz quanto está abaixo do teto da faixa", () => {
    // teto 315000, preço 289900 → 8% abaixo
    expect(formatAlerta(hunt, post, null)).toMatch(/8%/);
  });

  // Mesmo defeito de `formatSearch`: o post abre com uma linha só de emoji e
  // `formatAlerta` usava a mesma lógica de "primeira linha não-vazia" —
  // agora extraída para `tituloDoPost` em `lib/bot/format.ts`.
  it("post abre com linha de emoji: o título do alerta é o nome do produto, não o emoji", () => {
    const s = formatAlerta(
      hunt,
      { ...post, text: "🚨🚨\nGalaxy S25+ 256GB por R$ 2.899,00" },
      null,
    );
    expect(s).toContain("Galaxy S25+ 256GB por R$ 2.899,00");
    expect(s).not.toContain("🚨🚨");
  });
});

describe("formatAlerta com contexto de mercado", () => {
  const stats = {
    count: 91,
    minCents: 351900,
    medianCents: 396800,
    maxCents: 449900,
  };

  it("diz quanto está abaixo da mediana quando há estatística", () => {
    const s = formatAlerta(hunt, post, stats);
    // 289900 contra mediana 396800 → 27% abaixo
    expect(s).toMatch(/27%/);
    expect(s.toLowerCase()).toContain("mediana");
  });

  it("mantém a leitura da faixa do usuário", () => {
    expect(formatAlerta(hunt, post, stats).toLowerCase()).toContain("faixa");
  });

  it("omite a linha de mercado quando não há estatística", () => {
    const s = formatAlerta(hunt, post, null);
    expect(s.toLowerCase()).not.toContain("mediana");
    expect(s).toContain(formatBRL(post.priceCents));
  });

  it("não quebra quando o preço está acima da mediana", () => {
    const caro = { ...post, priceCents: 420000 };
    expect(() => formatAlerta(hunt, caro, stats)).not.toThrow();
  });
});

const AGORA = new Date("2026-08-11T12:00:00.000Z");

const huntRow = {
  id: "h1",
  chat_id: 7,
  label: "Galaxy S25+",
  query: "s25 plus",
  terms_any: ["s25+"],
  terms_none: [],
  price_min_cents: 285000,
  price_max_cents: 315000,
  is_active: true,
};

const postRow = {
  id: 10,
  text: "Galaxy S25+ 256GB por R$ 2.899,00",
  price_cents: 289900,
  store: "amazon",
  url: "https://t.me/x/10",
  posted_at: "2026-08-11T09:00:00Z",
};

const pendente = { id: 55, hunt_id: "h1", post_row_id: 10, attempts: 0 };

/** Cenário completo: 1 caça ativa, 1 post casando, 1 alerta pendente. */
function cenario(
  over: {
    claim?: Record<string, unknown>[];
    pendentes?: Record<string, unknown>[];
    inseridos?: Record<string, unknown>[];
    hunts?: Record<string, unknown>[];
    posts?: Record<string, unknown>[];
  } = {},
) {
  return createQueryFake({
    select: {
      hunts: over.hunts ?? [huntRow],
      posts: over.posts ?? [postRow],
      alerts: over.pendentes ?? [pendente],
    },
    // O `update` de alerts responde ao claim; `[{id}]` = claim ganho.
    update: { alerts: over.claim ?? [{ id: 55 }], hunts: [] },
    upsert: { alerts: over.inseridos ?? [{ id: 55 }] },
  });
}

describe("processarAlertas — janela de casamento", () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
  });

  it("só considera post publicado nas últimas 48h", async () => {
    const db = cenario();
    await processarAlertas(db.client, "tok", AGORA);

    const janela = db.de("select", "posts")[0];
    // `id` é bigserial (ordem de gravação), não de publicação: sem este piso
    // o backfill injetava post de março na janela como se fosse recente.
    expect(argsDe(janela, "gte")).toEqual(["posted_at", "2026-08-09T12:00:00.000Z"]);
    expect(argsDe(janela, "limit")).toEqual([500]);
  });

  it("conta em `casados` só as linhas realmente inseridas, não a janela toda", async () => {
    // 1 post × 1 caça casa, mas o upsert com ON CONFLICT DO NOTHING devolve
    // vazio quando o alerta já existia de um tick anterior.
    const db = cenario({ inseridos: [] });
    const r = await processarAlertas(db.client, "tok", AGORA);
    expect(r.casados).toBe(0);

    const upsert = db.de("upsert", "alerts")[0];
    expect(upsert.rows).toEqual([{ hunt_id: "h1", post_row_id: 10, kind: "faixa" }]);
    expect(argsDe(upsert, "select")).toEqual(["id"]);
  });
});

describe("processarAlertas — claim com lease", () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
  });

  it("a busca por pendentes exclui quem já foi reivindicado dentro do lease", async () => {
    const db = cenario();
    await processarAlertas(db.client, "tok", AGORA);

    const busca = db.de("select", "alerts")[0];
    expect(argsDe(busca, "is")).toEqual(["sent_at", null]);
    expect(argsDe(busca, "lt")).toEqual(["attempts", 5]);
    // lease de 2 min antes de `agora`
    expect(argsDe(busca, "or")).toEqual([
      "claimed_at.is.null,claimed_at.lt.2026-08-11T11:58:00.000Z",
    ]);
    expect(argsDe(busca, "limit")).toEqual([5]);
  });

  it("o claim aplica todos os filtros e incrementa attempts uma vez", async () => {
    const db = cenario();
    await processarAlertas(db.client, "tok", AGORA);

    const claim = db.de("update", "alerts")[0];
    expect(claim.patch).toEqual({
      attempts: 1,
      claimed_at: AGORA.toISOString(),
    });
    const eqs = todasAsChamadas(claim, "eq").map((c) => c.args);
    // id da linha E attempts lido: se outro tick já incrementou, não casa.
    expect(eqs).toContainEqual(["id", 55]);
    expect(eqs).toContainEqual(["attempts", 0]);
    expect(argsDe(claim, "is")).toEqual(["sent_at", null]);
    expect(argsDe(claim, "or")).toEqual([
      "claimed_at.is.null,claimed_at.lt.2026-08-11T11:58:00.000Z",
    ]);
    expect(argsDe(claim, "select")).toEqual(["id"]);
  });

  it("linha reivindicada por outro tick (claim não devolve linha) é pulada, sem envio", async () => {
    const db = cenario({ claim: [] });
    const r = await processarAlertas(db.client, "tok", AGORA);

    expect(sendMessageMock).not.toHaveBeenCalled();
    // "pulado" não é sucesso nem falha — a linha volta na próxima rodada.
    expect(r.enviados).toBe(0);
    expect(r.falhos).toBe(0);
    // e nada de sent_at gravado
    expect(db.de("update", "alerts")).toHaveLength(1);
  });

  it("grava sent_at e last_alert_at depois do envio bem-sucedido", async () => {
    const db = cenario();
    const r = await processarAlertas(db.client, "tok", AGORA);

    expect(r.enviados).toBe(1);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const [, chatId, html] = sendMessageMock.mock.calls[0];
    expect(chatId).toBe(7);
    expect(html).toContain("R$ 2.899,00");

    const updatesAlerts = db.de("update", "alerts");
    expect(updatesAlerts).toHaveLength(2);
    expect(updatesAlerts[1].patch).toEqual({ sent_at: AGORA.toISOString() });
    expect(argsDe(updatesAlerts[1], "eq")).toEqual(["id", 55]);

    // Dois updates em `hunts` por tick: a marca d'água da varredura e o
    // `last_alert_at` da entrega. Asserção por conteúdo, não por posição —
    // contar updates fazia este teste quebrar quando a marca d'água entrou.
    const updateHunts = db.de("update", "hunts");
    const marcados = updateHunts.filter((u) => "last_alert_at" in (u.patch ?? {}));
    expect(marcados).toHaveLength(1);
    expect(marcados[0].patch).toEqual({
      last_alert_at: AGORA.toISOString(),
    });
  });

  // Egress medido em 12/08: a consulta de casamento relia a janela de 48h
  // inteira a cada tick — 378 KB x 288 ticks/dia = 3,11 GB/mês, 62% do limite
  // de 5 GB/mês do free tier, antes de coleta, backfill e buscas.
  // Com a marca d'água o tick lê poucas linhas e o limite nunca é alcançado —
  // exceto no caso que importa: caça recém-criada tem marca 0 e varre as 48h
  // inteiras. Medido em 12/08 essas 48h têm 3.722 posts com preço, então "os
  // 500 mais recentes" cobriam 6,4h e a caça nova nascia meio cega.
  it("pede ao banco só a faixa de preço das caças ativas", async () => {
    const db = cenario({
      hunts: [
        { ...huntRow, price_min_cents: 285000, price_max_cents: 315000 },
        { ...huntRow, id: "h2", price_min_cents: 234000, price_max_cents: 363000 },
      ],
    });
    await processarAlertas(db.client, "tok", AGORA);

    const q = db.de("select", "posts")[0];
    const gtes = todasAsChamadas(q, "gte").map((c) => c.args);
    expect(gtes).toContainEqual(["price_cents", 234000]);
    expect(argsDe(q, "lte")).toEqual(["price_cents", 363000]);
  });

  it("lê só o que entrou depois da marca d'água, com a margem de segurança", async () => {
    const db = cenario({
      hunts: [{ ...huntRow, last_post_row_id: 5000 }],
    });
    await processarAlertas(db.client, "tok", AGORA);

    const selectPosts = db.de("select", "posts")[0];
    // 5000 - MARGEM_IDS (100)
    expect(argsDe(selectPosts, "gt")).toEqual(["id", 4900]);
  });

  it("caça nova (marca 0) varre a janela inteira — não nasce cega", async () => {
    // Quem cria uma caça quer saber da oferta que já está de pé, não só das
    // futuras. Uma caça com marca 0 puxa a varredura inteira de volta, mesmo
    // que as outras caças já estejam adiantadas.
    const db = cenario({
      hunts: [
        { ...huntRow, id: "antiga", last_post_row_id: 90000 },
        { ...huntRow, id: "nova", last_post_row_id: 0 },
      ],
    });
    await processarAlertas(db.client, "tok", AGORA);

    expect(argsDe(db.de("select", "posts")[0], "gt")).toEqual(["id", 0]);
  });

  it("avança a marca até o maior id examinado, só nas caças já lidas", async () => {
    const db = cenario();
    await processarAlertas(db.client, "tok", AGORA);

    const marca = db.de("update", "hunts").filter((u) => "last_post_row_id" in (u.patch ?? {}));
    expect(marca).toHaveLength(1);
    expect(marca[0].patch).toEqual({ last_post_row_id: 10 });
    // Restrito às caças lidas no início do tick: caça criada no meio do tick
    // tem marca 0 e ainda não varreu nada — bumpar a dela a faria nascer cega.
    expect(argsDe(marca[0], "in")).toEqual(["id", ["h1"]]);
    // `lt` impede que dois ticks concorrentes puxem a marca pra trás.
    expect(argsDe(marca[0], "lt")).toEqual(["last_post_row_id", 10]);
  });

  it("coluna ausente (deploy antes da migration 0005) varre tudo em vez de quebrar", async () => {
    const semColuna = { ...huntRow };
    const db = cenario({ hunts: [semColuna] });
    const r = await processarAlertas(db.client, "tok", AGORA);

    expect(argsDe(db.de("select", "posts")[0], "gt")).toEqual(["id", 0]);
    expect(r.enviados).toBe(1);
  });

  it("falha comum de envio mantém o attempts incrementado (queima tentativa)", async () => {
    sendMessageMock.mockRejectedValueOnce(new Error("Telegram sendMessage: HTTP 400 ruim"));
    const db = cenario();
    const r = await processarAlertas(db.client, "tok", AGORA);

    expect(r.falhos).toBe(1);
    // só o claim; nada de reverter nem de sent_at
    expect(db.de("update", "alerts")).toHaveLength(1);
  });

  it("429 devolve a linha à fila intacta em vez de queimar tentativa", async () => {
    sendMessageMock.mockRejectedValueOnce(new TelegramRateLimitError("sendMessage", 30, "{}"));
    const db = cenario();
    const r = await processarAlertas(db.client, "tok", AGORA);

    // 429 é ritmo, não defeito da linha: não conta como falha nem como envio.
    expect(r.enviados).toBe(0);
    expect(r.falhos).toBe(0);

    const updates = db.de("update", "alerts");
    expect(updates).toHaveLength(2);
    // reverte o incremento do claim e solta o lease
    expect(updates[1].patch).toEqual({ attempts: 0, claimed_at: null });
    expect(argsDe(updates[1], "eq")).toEqual(["id", 55]);
  });

  it("prazo estourado: nenhum envio inicia, nada é reivindicado, `adiados` conta os pendentes", async () => {
    const db = cenario({
      pendentes: [
        { id: 55, hunt_id: "h1", post_row_id: 10, attempts: 0 },
        { id: 56, hunt_id: "h1", post_row_id: 11, attempts: 0 },
      ],
    });
    // Acima de ORCAMENTO_ENTREGA_MS (35s) desde o primeiro instante.
    const r = await processarAlertas(db.client, "tok", AGORA, () => 40_000);

    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(r.enviados).toBe(0);
    expect(r.falhos).toBe(0);
    expect(r.adiados).toBe(2);
    // A guarda é checada antes do claim: nenhum update em `alerts` acontece.
    expect(db.de("update", "alerts")).toHaveLength(0);
  });

  it("prazo folgado não muda o comportamento (relógio real, bem abaixo do orçamento)", async () => {
    const db = cenario();
    const r = await processarAlertas(db.client, "tok", AGORA);

    expect(r.enviados).toBe(1);
    expect(r.adiados).toBe(0);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });

  // A versão anterior deste teste injetava um `decorridoMs` que contava
  // CHAMADAS, não tempo. Ele passava com a guarda inerte: `Promise.allSettled`
  // invoca as LOTE_ENVIO chamadas sincronamente, e a guarda ficava antes de
  // qualquer `await`, então as cinco liam o mesmo instante — medido em 12/08,
  // `[2,2,2,2,2]` ms numa execução de 344 ms. O contador de chamadas fabricava
  // uma passagem de tempo que o relógio real nunca produzia.
  //
  // Aqui o relógio só anda DENTRO do `sendMessage`. Um mecanismo que checa o
  // prazo só na largada lê 0 nas três vezes e envia as três.
  it("prazo é checado entre os envios, não só na largada", async () => {
    const db = cenario({
      pendentes: [
        { id: 55, hunt_id: "h1", post_row_id: 10, attempts: 0 },
        { id: 56, hunt_id: "h1", post_row_id: 11, attempts: 0 },
        { id: 57, hunt_id: "h1", post_row_id: 12, attempts: 0 },
      ],
    });
    let relogio = 0;
    sendMessageMock.mockImplementation(async () => {
      relogio += 50;
    });
    const r = await processarAlertas(db.client, "tok", AGORA, () => relogio, 75);

    // 1º envio na largada (0), 2º aos 50 (dentro), 3º aos 100 (estourado).
    expect(r.enviados).toBe(2);
    expect(r.adiados).toBe(1);
    expect(r.falhos).toBe(0);
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
  });

  it("linha adiada volta limpa pra fila — sem queimar tentativa nem travar no lease", async () => {
    // Se o adiamento deixasse `attempts` incrementado e `claimed_at` gravado,
    // um tick apertado gastaria as MAX_TENTATIVAS da linha sem nunca tentar
    // entregar, e ela ficaria travada até o lease vencer.
    const db = cenario({
      pendentes: [
        { id: 55, hunt_id: "h1", post_row_id: 10, attempts: 0 },
        { id: 56, hunt_id: "h1", post_row_id: 11, attempts: 2 },
      ],
    });
    let relogio = 0;
    sendMessageMock.mockImplementation(async () => {
      relogio += 50;
    });
    const r = await processarAlertas(db.client, "tok", AGORA, () => relogio, 25);

    expect(r.adiados).toBe(1);
    const revert = db.de("update", "alerts").filter((u) => (u.patch ?? {}).claimed_at === null);
    expect(revert).toHaveLength(1);
    expect(revert[0].patch).toEqual({ attempts: 2, claimed_at: null });
  });

  // O plano (item 2 do PLANO-MELHORIAS) pedia explicitamente um teste de
  // relógio de verdade, com envio artificialmente lento: "senão o próximo
  // mecanismo também vai parecer funcionar sem funcionar". Este é ele — usa
  // `cronometro()` real (o default), só o orçamento é injetado.
  it("com relógio de verdade e envio lento, o lote para no meio", async () => {
    const db = cenario({
      pendentes: [
        { id: 55, hunt_id: "h1", post_row_id: 10, attempts: 0 },
        { id: 56, hunt_id: "h1", post_row_id: 11, attempts: 0 },
        { id: 57, hunt_id: "h1", post_row_id: 12, attempts: 0 },
      ],
    });
    sendMessageMock.mockImplementation(() => new Promise((r) => setTimeout(r, 50)));
    const r = await processarAlertas(db.client, "tok", AGORA, undefined, 75);

    expect(r.enviados).toBe(2);
    expect(r.adiados).toBe(1);
  });

  it("serializa envios para o mesmo chat em vez de disparar o lote junto", async () => {
    let emVoo = 0;
    let maxSimultaneos = 0;
    sendMessageMock.mockImplementation(async () => {
      emVoo++;
      maxSimultaneos = Math.max(maxSimultaneos, emVoo);
      await new Promise((r) => setTimeout(r, 1));
      emVoo--;
    });
    const db = cenario({
      pendentes: [
        { id: 55, hunt_id: "h1", post_row_id: 10, attempts: 0 },
        { id: 56, hunt_id: "h1", post_row_id: 11, attempts: 0 },
        { id: 57, hunt_id: "h1", post_row_id: 12, attempts: 0 },
      ],
      claim: [{ id: 55 }],
    });
    const r = await processarAlertas(db.client, "tok", AGORA);

    expect(r.enviados).toBe(3);
    expect(sendMessageMock).toHaveBeenCalledTimes(3);
    // mesmo chat (7) nos três: o Telegram limita ~1 msg/s por chat.
    expect(maxSimultaneos).toBe(1);
  });
});

describe("processarAlertas — mediana de mercado (wiring)", () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
  });

  // Preços fora da faixa do usuário (285000–315000 centavos), só pra
  // alimentar `buscar`: não casam com `hunt` (preço fora do range), então
  // não viram alerta novo — servem só de "mercado" pro cálculo da mediana.
  const mercado = [
    {
      id: 20,
      text: "Galaxy S25+ 512GB",
      price_cents: 351900,
      store: "loja1",
      url: "https://t.me/x/20",
      posted_at: "2026-08-01T09:00:00Z",
    },
    {
      id: 21,
      text: "Galaxy S25+ 512GB",
      price_cents: 396800,
      store: "loja2",
      url: "https://t.me/x/21",
      posted_at: "2026-08-02T09:00:00Z",
    },
    {
      id: 22,
      text: "Galaxy S25+ 512GB",
      price_cents: 420000,
      store: "loja3",
      url: "https://t.me/x/22",
      posted_at: "2026-08-03T09:00:00Z",
    },
    {
      id: 23,
      text: "Galaxy S25+ 512GB",
      price_cents: 449900,
      store: "loja4",
      url: "https://t.me/x/23",
      posted_at: "2026-08-04T09:00:00Z",
    },
  ];

  it("a mensagem enviada traz a mediana calculada por `buscar` — prova o wiring, não só o formato", async () => {
    // Este teste é o que falharia se `statsDaCaca` sempre devolvesse `null`
    // (wiring quebrado): configura o fake pra `buscar` achar preços de
    // verdade, roda `processarAlertas` de ponta a ponta, e verifica o texto
    // que de fato foi pro Telegram — não `formatAlerta` chamado direto com
    // um `stats` já pronto.
    const db = createQueryFake({
      select: {
        hunts: [huntRow],
        // `postRow` primeiro: o fake de `.single()` sempre devolve a
        // primeira linha configurada, e é ela que representa o post do
        // alerta pendente.
        posts: [postRow, ...mercado],
        alerts: [pendente],
      },
      update: { alerts: [{ id: 55 }], hunts: [] },
      upsert: { alerts: [{ id: 55 }] },
    });

    const r = await processarAlertas(db.client, "tok", AGORA);

    expect(r.enviados).toBe(1);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const [, , html] = sendMessageMock.mock.calls[0];
    // mediana de {289900, 351900, 396800, 420000, 449900} = 396800;
    // preço do alerta 289900 contra 396800 → 27% abaixo.
    expect(html.toLowerCase()).toContain("mediana");
    expect(html).toMatch(/27%/);
  });
});

describe("alerta com foto", () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    sendPhotoMock.mockReset();
  });

  const comFoto = { ...postRow, photo_url: "https://cdn1.telesco.pe/file/abc.jpg" };

  // Medido sobre 300 alertas reais: mediana de 330 caracteres e máximo de 427,
  // contra o limite de 1024 da legenda. Cabe em 100% dos casos — é por isso
  // que a imagem entra aqui e não no /agora, que junta cinco ofertas.
  it("post com foto vira sendPhoto, com o alerta de legenda", async () => {
    const db = cenario({ posts: [comFoto] });
    await processarAlertas(db.client, "tok", AGORA);

    expect(sendPhotoMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).not.toHaveBeenCalled();
    const [, , foto, legenda] = sendPhotoMock.mock.calls[0];
    expect(foto).toBe("https://cdn1.telesco.pe/file/abc.jpg");
    expect(legenda).toContain("R$ 2.899,00");
  });

  it("post sem foto continua em texto", async () => {
    const db = cenario();
    await processarAlertas(db.client, "tok", AGORA);

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendPhotoMock).not.toHaveBeenCalled();
  });

  // O que mais importa desta rodada: a imagem é enfeite, o alerta é o produto.
  // URL do CDN pode expirar, o Telegram pode recusar o formato, o host pode
  // cair — em nenhum desses casos o alerta pode se perder.
  it("foto que falha não perde o alerta: cai pra texto", async () => {
    sendPhotoMock.mockRejectedValueOnce(new Error("Telegram sendPhoto: HTTP 400 wrong file"));
    const db = cenario({ posts: [comFoto] });
    const r = await processarAlertas(db.client, "tok", AGORA);

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(r.enviados).toBe(1);
    expect(r.falhos).toBe(0);
  });

  // 429 é exceção à exceção: é ritmo, não problema da imagem, e tem tratamento
  // próprio (devolve a linha à fila). Reenviar como texto furaria isso e
  // ainda pioraria a rajada.
  it("429 na foto não vira reenvio como texto", async () => {
    sendPhotoMock.mockRejectedValueOnce(new TelegramRateLimitError("sendPhoto", 30, "{}"));
    const db = cenario({ posts: [comFoto] });
    const r = await processarAlertas(db.client, "tok", AGORA);

    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(r.enviados).toBe(0);
  });

  it("lê a coluna photo_url do banco", async () => {
    const db = cenario({ posts: [comFoto] });
    await processarAlertas(db.client, "tok", AGORA);

    const selects = db.de("select", "posts").map((q) => argsDe(q, "select")?.[0]);
    expect(selects.some((s) => String(s).includes("photo_url"))).toBe(true);
  });
});

describe("aviso de aproximação", () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    sendPhotoMock.mockReset();
  });

  // Teto da caça é 315000; 330000 fica 4,8% acima, dentro da margem de 8%.
  const pertoRow = { ...postRow, price_cents: 330000 };

  it("preço acima do teto vira alerta de tipo 'perto', não 'faixa'", async () => {
    const db = cenario({ posts: [pertoRow] });
    await processarAlertas(db.client, "tok", AGORA);

    const up = db.de("upsert", "alerts")[0];
    expect(up.rows).toEqual([{ hunt_id: "h1", post_row_id: 10, kind: "perto" }]);
  });

  it("a mensagem do aviso não se confunde com a do alerta", async () => {
    const db = cenario({ posts: [pertoRow], pendentes: [{ ...pendente, kind: "perto" }] });
    await processarAlertas(db.client, "tok", AGORA);

    const [, , html] = sendMessageMock.mock.calls[0];
    expect(html).toContain("chegou perto");
    expect(html).toContain("acima do seu teto");
    // O alerta de verdade diz quanto está ABAIXO; o aviso nunca pode dizer
    // isso, senão gasta a confiança que o alerta precisa ter.
    expect(html).not.toContain("abaixo do teto");
  });

  it("aviso diz quanto falta em reais, não só em porcentagem", async () => {
    const db = cenario({ posts: [pertoRow], pendentes: [{ ...pendente, kind: "perto" }] });
    await processarAlertas(db.client, "tok", AGORA);

    // 330000 - 315000 = 15000
    expect(sendMessageMock.mock.calls[0][2]).toContain("R$ 150,00");
  });

  // O aviso não afirma que é bom negócio, então não gasta consulta de mercado.
  it("aviso não busca estatística de mercado", async () => {
    const db = cenario({ posts: [pertoRow], pendentes: [{ ...pendente, kind: "perto" }] });
    await processarAlertas(db.client, "tok", AGORA);

    const [, , html] = sendMessageMock.mock.calls[0];
    expect(html.toLowerCase()).not.toContain("mediana");
  });

  it("preço muito acima do teto não vira nem aviso", async () => {
    const db = cenario({ posts: [{ ...postRow, price_cents: 500000 }] });
    const r = await processarAlertas(db.client, "tok", AGORA);
    expect(r.casados).toBe(0);
  });
});
