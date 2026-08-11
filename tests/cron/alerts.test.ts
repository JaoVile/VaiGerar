import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatAlerta, processarAlertas } from "@/lib/cron/alerts";
import { TelegramRateLimitError } from "@/lib/telegram";
import { argsDe, createQueryFake, todasAsChamadas } from "@/tests/helpers/fake-db";

// Só o I/O do Telegram é mockado; `escapeHtml` e `TelegramRateLimitError`
// continuam reais.
const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));
vi.mock("@/lib/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/telegram")>()),
  sendMessage: sendMessageMock,
}));

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

  it("mostra a data do post — oferta antiga tem que se denunciar", () => {
    // Sem a data, "R$ 2.899,00 — 8% abaixo do teto" parece oferta de agora
    // mesmo quando não é; o usuário só descobre clicando.
    expect(formatAlerta(hunt, post)).toContain("2026-08-10");
  });

  it("diz quanto está abaixo do teto da faixa", () => {
    // teto 315000, preço 289900 → 8% abaixo
    expect(formatAlerta(hunt, post)).toMatch(/8%/);
  });
});

const AGORA = new Date("2026-08-11T12:00:00.000Z");

const huntRow = {
  id: "h1",
  chat_id: 7,
  label: "Galaxy S25+",
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
  } = {},
) {
  return createQueryFake({
    select: {
      hunts: [huntRow],
      posts: [postRow],
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
    expect(upsert.rows).toEqual([{ hunt_id: "h1", post_row_id: 10 }]);
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

    const updateHunts = db.de("update", "hunts");
    expect(updateHunts).toHaveLength(1);
    expect(updateHunts[0].patch).toEqual({
      last_alert_at: AGORA.toISOString(),
    });
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

  it("prazo estoura no meio do lote: as primeiras são enviadas, as seguintes ficam para depois", async () => {
    const db = cenario({
      pendentes: [
        { id: 55, hunt_id: "h1", post_row_id: 10, attempts: 0 },
        { id: 56, hunt_id: "h1", post_row_id: 11, attempts: 0 },
        { id: 57, hunt_id: "h1", post_row_id: 12, attempts: 0 },
      ],
      claim: [{ id: 55 }],
    });
    let chamada = 0;
    // A guarda é checada, por item, antes de qualquer `await` — então as
    // chamadas acontecem na ordem do `pendentes`, mesmo com o resto correndo
    // em paralelo. 1ª e 2ª: dentro do orçamento. 3ª em diante: estourado.
    const decorridoMs = () => {
      chamada++;
      return chamada <= 2 ? 1_000 : 40_000;
    };
    const r = await processarAlertas(db.client, "tok", AGORA, decorridoMs);

    expect(r.enviados).toBe(2);
    expect(r.adiados).toBe(1);
    expect(r.falhos).toBe(0);
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    // 2 claims + 2 gravações de sent_at; a 3ª linha nunca chega no update.
    expect(db.de("update", "alerts")).toHaveLength(4);
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
