import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { autorizado, extrairEntrada, tratar } from "@/lib/bot/router";
import { FLOW_BUSCA, FLOW_CACA } from "@/lib/bot/session";
import type { SearchResult } from "@/lib/search/query";

// Mocka só o I/O do Telegram; `escapeHtml` continua sendo o de verdade —
// é justamente ele que está sob teste no bloco de /cacas abaixo.
const { sendMessageMock, answerCallbackQueryMock, editMessageTextMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
  answerCallbackQueryMock: vi.fn(),
  editMessageTextMock: vi.fn(),
}));
vi.mock("@/lib/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/telegram")>()),
  sendMessage: sendMessageMock,
  answerCallbackQuery: answerCallbackQueryMock,
  editMessageText: editMessageTextMock,
}));

// `buscar` mockado, mas imitando o comportamento real que importa pro bug que
// este mock existe pra travar: sem `opts.limite`, devolve só 5 `melhores`
// (o mesmo default de `LIMITE_PADRAO` em `lib/search/query.ts`). Se o
// roteador parar de passar `{ limite: LIMITE_PAGINACAO }`, este mock volta a
// se comportar como o `buscar` real sem paginação — e o botão "mais ofertas"
// some, do jeito que sumiria em produção.
const { buscarMock } = vi.hoisted(() => ({ buscarMock: vi.fn() }));
vi.mock("@/lib/search/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/search/query")>()),
  buscar: buscarMock,
}));

describe("extrairEntrada", () => {
  it("lê mensagem de texto", () => {
    expect(extrairEntrada({ message: { chat: { id: 7 }, text: "oi" } })).toEqual({
      chatId: 7,
      texto: "oi",
      callbackId: undefined,
    });
  });

  it("lê clique de botão, trazendo o callback_data como texto", () => {
    const r = extrairEntrada({
      callback_query: {
        id: "cb1",
        data: "tol:10",
        message: { chat: { id: 7 } },
      },
    });
    expect(r).toEqual({ chatId: 7, texto: "10", callbackId: "cb1" });
  });

  it("devolve null para update sem texto nem callback", () => {
    expect(extrairEntrada({})).toBeNull();
  });

  it("devolve null para mensagem sem texto (foto, sticker)", () => {
    expect(extrairEntrada({ message: { chat: { id: 7 } } })).toBeNull();
  });

  it("devolve null para corpo null, sem lançar", () => {
    expect(extrairEntrada(null as unknown as Parameters<typeof extrairEntrada>[0])).toBeNull();
  });

  it("devolve null para callback_query com message vazio, sem lançar", () => {
    const r = extrairEntrada({
      callback_query: {
        id: "1",
        data: "d",
        message: {},
      } as unknown as Parameters<typeof extrairEntrada>[0]["callback_query"],
    });
    expect(r).toBeNull();
  });

  it("devolve null para message sem chat, sem lançar", () => {
    const r = extrairEntrada({
      message: {} as unknown as Parameters<typeof extrairEntrada>[0]["message"],
    });
    expect(r).toBeNull();
  });

  it("devolve null para callback_query.data numérico, sem lançar", () => {
    const r = extrairEntrada({
      callback_query: {
        id: "1",
        data: 123,
        message: { chat: { id: 7 } },
      } as unknown as Parameters<typeof extrairEntrada>[0]["callback_query"],
    });
    expect(r).toBeNull();
  });

  it("devolve null para message.text numérico, sem lançar", () => {
    const r = extrairEntrada({
      message: { chat: { id: 7 }, text: 123 } as unknown as Parameters<
        typeof extrairEntrada
      >[0]["message"],
    });
    expect(r).toBeNull();
  });

  it("extrai o messageId do callback, necessário para editar a mensagem", () => {
    const r = extrairEntrada({
      callback_query: {
        id: "cb",
        data: "pag:5",
        message: { message_id: 42, chat: { id: 7 } },
      },
    });
    expect(r?.messageId).toBe(42);
  });

  it("mensagem comum não traz messageId de edição", () => {
    expect(extrairEntrada({ message: { chat: { id: 7 }, text: "oi" } })?.messageId).toBeUndefined();
  });
});

describe("autorizado", () => {
  it("aceita chat da allowlist", () => {
    expect(autorizado(7, [7, 9])).toBe(true);
  });
  it("recusa chat de fora", () => {
    expect(autorizado(8, [7, 9])).toBe(false);
  });
  it("recusa tudo quando a allowlist está vazia", () => {
    expect(autorizado(7, [])).toBe(false);
  });
});

/** Fake mínimo pro caminho de /cacas: só `hunts.select().eq().order()`. */
function dbComHunts(hunts: Array<Record<string, unknown>>): SupabaseClient {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => Promise.resolve({ data: hunts, error: null })),
  };
  return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
}

// `query` default = `label` mantém os testes antigos (que não configuram
// `buscarMock`) intocados. Os testes de wiring abaixo passam um `query`
// deliberadamente diferente do `label`, pra pegar quem trocar um pelo outro.
const hunt = (label: string, query = label) => ({
  id: "11111111-1111-1111-1111-111111111111",
  label,
  query,
  price_min_cents: 285000,
  price_max_cents: 315000,
  is_active: true,
});

describe("tratar /cacas", () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    answerCallbackQueryMock.mockReset();
    buscarMock.mockReset();
  });

  it("lista as caças ativas com a faixa de preço", async () => {
    await tratar(dbComHunts([hunt("s25 plus")]), "tok", {
      chatId: 7,
      texto: "/cacas",
    });
    const [, , html] = sendMessageMock.mock.calls[0];
    expect(html).toContain("s25 plus");
    expect(html).toContain("R$ 2.850,00");
  });

  // Sem escape isto é uma trava permanente: o Telegram recusa a mensagem
  // ("can't parse entities"), o envio lança — e o botão de excluir a caça
  // que trava a lista vive DENTRO da mensagem que não consegue ser enviada.
  it('escapa "<" e "&" do rótulo da caça na listagem', async () => {
    await tratar(dbComHunts([hunt("tv <50 & cia")]), "tok", {
      chatId: 7,
      texto: "/cacas",
    });
    const [, , html] = sendMessageMock.mock.calls[0];
    expect(html).toContain("tv &lt;50 &amp; cia");
    expect(html).not.toContain("<50");
    // O texto do botão NÃO é parseado como HTML pelo Telegram — escapar ali
    // mostraria "&lt;" literal para o usuário. Fica cru de propósito.
    const [, , , opts] = sendMessageMock.mock.calls[0];
    expect(opts.keyboard.inline_keyboard[0][0].text).toBe("Excluir tv <50 & cia");
  });

  it("avisa quando não há nenhuma caça ativa", async () => {
    await tratar(dbComHunts([]), "tok", { chatId: 7, texto: "/cacas" });
    expect(String(sendMessageMock.mock.calls[0][2])).toContain("Nenhuma caça ativa");
  });

  // Fix round 1: os três testes acima nunca configuram `buscarMock`, então
  // `buscar` sempre devolve `undefined`, o `try/catch` do router engole o
  // erro e os dois campos de mercado ficam `null` — os 223 testes anteriores
  // passavam mesmo com `h.query` trocado por `h.label`, um nome de campo
  // errado (`price_cents` em vez de `priceCents`), ou a chamada a `buscar`
  // comentada inteira. Este teste roda o handler de verdade com um
  // `SearchResult` real e afirma sobre a mensagem enviada — e o `query` da
  // caça é deliberadamente diferente do `label` pra pegar quem usar o
  // campo errado.
  it("busca o mercado de cada caça pelo `query` e mostra melhor preço e % acima do teto", async () => {
    buscarMock.mockImplementation((_db: unknown, termo: string) => {
      if (termo !== "termo de mercado") {
        return Promise.reject(new Error(`termo inesperado: ${termo}`));
      }
      return Promise.resolve({
        termo,
        stats: {
          count: 9,
          minCents: 300000,
          medianCents: 340000,
          maxCents: 500000,
        },
        melhores: [
          {
            text: "Galaxy S25 Plus lacrado",
            priceCents: 346500,
            store: "amazon",
            postedAt: "2026-08-01T12:00:00Z",
            url: "https://t.me/x/1",
          },
        ],
      });
    });

    await tratar(dbComHunts([hunt("s25 plus", "termo de mercado")]), "tok", {
      chatId: 7,
      texto: "/cacas",
    });

    expect(buscarMock).toHaveBeenCalledWith(expect.anything(), "termo de mercado", {
      limite: 1,
    });
    const [, , html] = sendMessageMock.mock.calls[0];
    // melhor atual (346500 = R$ 3.465,00) e teto da faixa (315000) → 10% acima
    expect(html).toContain("R$ 3.465,00");
    expect(html).toMatch(/10%/);
    expect(html).toContain("R$ 3.400,00"); // mediana de 3 meses, também extraída de `r.stats`
  });

  // Minor do revisor: prova o isolamento por caça fim-a-fim — uma caça com
  // dado de mercado real e outra cujo `buscar` falha aparecem na MESMA
  // mensagem, cada uma com o estado certo. Sem este teste, um bug que
  // vazasse a falha de uma caça pra todas (ou vice-versa) passaria batido.
  it("isola falha por caça: uma caça com dado, outra sem, na mesma mensagem", async () => {
    buscarMock.mockImplementation((_db: unknown, termo: string) => {
      if (termo === "termo bom") {
        return Promise.resolve({
          termo,
          stats: {
            count: 3,
            minCents: 280000,
            medianCents: 300000,
            maxCents: 320000,
          },
          melhores: [
            {
              text: "oferta boa",
              priceCents: 300000,
              store: "amazon",
              postedAt: "2026-08-01T12:00:00Z",
              url: "https://t.me/x/2",
            },
          ],
        });
      }
      return Promise.reject(new Error("mercado fora do ar"));
    });

    const hunts = [hunt("caça boa", "termo bom"), hunt("caça ruim", "termo ruim")];
    await tratar(dbComHunts(hunts), "tok", { chatId: 7, texto: "/cacas" });

    const [, , html] = sendMessageMock.mock.calls[0];
    expect(html).toContain("caça boa");
    expect(html).toContain("R$ 3.000,00");
    expect(html.toLowerCase()).toContain("já apareceu na sua faixa");
    expect(html).toContain("caça ruim");
    expect(html.toLowerCase()).toContain("nenhuma oferta");
  });
});

/**
 * Fake mínimo pro caminho de `/agora`: só `bot_sessions.select().eq()
 * .maybeSingle()` (lido por `lerSessao`) e `bot_sessions.upsert()` (escrito
 * por `salvarSessao`). `sessaoInicial` é o que `lerSessao` devolve — `null`
 * simula chat sem sessão ativa.
 */
function dbSessoes(sessaoInicial: Record<string, unknown> | null): {
  db: SupabaseClient;
  upserts: Array<Record<string, unknown>>;
} {
  const upserts: Array<Record<string, unknown>> = [];
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve({ data: sessaoInicial, error: null })),
    upsert: vi.fn((row: Record<string, unknown>) => {
      upserts.push(row);
      return Promise.resolve({ data: null, error: null });
    }),
  };
  return {
    db: { from: vi.fn(() => chain) } as unknown as SupabaseClient,
    upserts,
  };
}

/** 12 ofertas fake, ordenadas por preço — o bastante pra passar de uma página. */
function buscarFake(
  _db: SupabaseClient,
  termo: string,
  opts?: { meses?: number; limite?: number },
): Promise<SearchResult> {
  // Sem `opts.limite`, imita o LIMITE_PADRAO=5 real — é o que faz este mock
  // pegar a regressão, não só simular um `buscar` genérico.
  const limite = opts?.limite ?? 5;
  const todos = Array.from({ length: 12 }, (_, i) => ({
    text: `Produto ${i}`,
    priceCents: (i + 1) * 1000,
    store: "amazon",
    postedAt: "2026-08-01T12:00:00Z",
    url: `https://t.me/x/${i}`,
  }));
  return Promise.resolve({
    termo,
    stats: {
      count: todos.length,
      minCents: 1000,
      medianCents: 6500,
      maxCents: 12000,
    },
    melhores: todos.slice(0, limite),
  });
}

describe("tratar /agora", () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    answerCallbackQueryMock.mockReset();
    buscarMock.mockReset();
    buscarMock.mockImplementation(buscarFake);
  });

  // Achado 1 do fix round 1: nada travava `LIMITE_PAGINACAO` — os 214 testes
  // da Task 3 passavam mesmo removendo `{ limite: LIMITE_PAGINACAO }` do
  // roteador, porque nenhum chamava `tratar()` com `/agora`. Este teste falha
  // nesse cenário: sem o `limite` maior, `buscarFake` devolve só 5
  // `melhores` e o botão "mais ofertas ▶" nunca aparece.
  it('/agora com mais de 5 resultados oferece o botão "mais ofertas"', async () => {
    const { db } = dbSessoes(null);
    await tratar(db, "tok", { chatId: 7, texto: "/agora air fryer" });

    const ultimaChamada = sendMessageMock.mock.calls.at(-1);
    const opts = ultimaChamada?.[3] as {
      keyboard?: { inline_keyboard: unknown[][] };
    };
    const cbs = (
      (opts?.keyboard?.inline_keyboard.flat() ?? []) as Array<{
        callback_data: string;
      }>
    ).map((b) => b.callback_data);
    expect(cbs).toContain("pag:5");
  });

  it("sem sessão de caça ativa, /agora não avisa cancelamento", async () => {
    const { db } = dbSessoes(null);
    await tratar(db, "tok", { chatId: 7, texto: "/agora air fryer" });

    const textos = sendMessageMock.mock.calls.map((c) => String(c[2]));
    expect(textos.some((t) => t.toLowerCase().includes("cancelada"))).toBe(false);
  });

  it("com sessão de caça em andamento, /agora avisa que ela foi cancelada", async () => {
    const { db } = dbSessoes({
      flow: FLOW_CACA,
      step: "ask_product",
      data: {},
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    await tratar(db, "tok", { chatId: 7, texto: "/agora air fryer" });

    const textos = sendMessageMock.mock.calls.map((c) => String(c[2]));
    expect(textos.some((t) => t.toLowerCase().includes("cancelada"))).toBe(true);
    expect(textos.some((t) => t.includes("/cacar"))).toBe(true);
    // A busca continua acontecendo — o aviso é além do resultado, não em vez dele.
    expect(sendMessageMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * Fake com sessão **persistente**: `upsert` grava, `maybeSingle` devolve o que
 * foi gravado. `dbSessoes` (acima) não serve aqui — ele devolve sempre a mesma
 * sessão inicial, então um `/agora` que deixasse de chamar `salvarSessao`
 * passaria batido. Com estado de verdade, o teste fim a fim `/agora` → clique
 * em "mais ofertas" cobra o fio inteiro.
 */
function dbSessaoPersistente(inicial: Record<string, unknown> | null = null): SupabaseClient {
  let linha = inicial;
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve({ data: linha, error: null })),
    upsert: vi.fn((row: Record<string, unknown>) => {
      linha = row;
      return Promise.resolve({ data: null, error: null });
    }),
    delete: vi.fn(() => chain),
  };
  return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
}

/** Sessão de busca válida, do jeito que `salvarSessao` grava. */
function sessaoDeBusca(termo: string): Record<string, unknown> {
  return {
    flow: FLOW_BUSCA,
    step: "resultado",
    data: { termo },
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
}

function callbacksDe(opts: unknown): string[] {
  const kb = (opts as { keyboard?: { inline_keyboard: Array<Array<{ callback_data: string }>> } })
    ?.keyboard;
  return (kb?.inline_keyboard.flat() ?? []).map((b) => b.callback_data);
}

/**
 * Achado do review final: o handler do botão "mais ofertas" não tinha teste
 * nenhum. Provado por mutação — trocar todo o bloco `if (texto.startsWith("pag:"))`
 * por `return;` deixava os 225 testes passando, e `editMessageText` não
 * aparecia em nenhum deles. `formatSearchPagina` estava coberto; o *fio* que
 * faz o botão funcionar (ler a sessão, checar o flow, re-buscar, editar a
 * mensagem) não estava.
 */
describe('tratar clique de "mais ofertas" (pag:)', () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    answerCallbackQueryMock.mockReset();
    editMessageTextMock.mockReset();
    buscarMock.mockReset();
    buscarMock.mockImplementation(buscarFake);
  });

  it("com sessão de busca válida, edita a mensagem original com a página pedida", async () => {
    const db = dbSessaoPersistente(sessaoDeBusca("air fryer"));
    await tratar(db, "tok", {
      chatId: 7,
      texto: "pag:5",
      callbackId: "cb1",
      messageId: 42,
    });

    // O clique é confirmado (senão o Telegram deixa o botão "girando").
    expect(answerCallbackQueryMock).toHaveBeenCalledWith("tok", "cb1");

    expect(editMessageTextMock).toHaveBeenCalledTimes(1);
    const [token, chatId, messageId, html, opts] = editMessageTextMock.mock.calls[0];
    expect(token).toBe("tok");
    expect(chatId).toBe(7);
    // O messageId do clique é o que faz a página trocar na mesma mensagem em
    // vez de empilhar mensagem nova a cada clique.
    expect(messageId).toBe(42);

    // Conteúdo da página 2 (offset 5, 5 por página): itens 5..9, e não o 0.
    expect(html).toContain("Produto 5");
    expect(html).toContain("Produto 9");
    expect(html).not.toContain("Produto 0");
    expect(html).toContain("mostrando 6–10 de 12");
    expect(callbacksDe(opts)).toEqual(expect.arrayContaining(["pag:0", "pag:10"]));

    // Editar é o ponto do botão: mandar mensagem nova aqui seria a regressão.
    expect(sendMessageMock).not.toHaveBeenCalled();

    // Re-busca pelo termo guardado na sessão, com o limite de paginação (não o
    // default de 5 — senão a página 2 nem existiria).
    const [, termoBuscado, optsBusca] = buscarMock.mock.calls.at(-1) as [
      unknown,
      string,
      { limite: number },
    ];
    expect(termoBuscado).toBe("air fryer");
    expect(optsBusca.limite).toBeGreaterThan(5);
  });

  it("sem sessão nenhuma, avisa que a busca expirou e não edita nada", async () => {
    const db = dbSessaoPersistente(null);
    await tratar(db, "tok", {
      chatId: 7,
      texto: "pag:5",
      callbackId: "cb1",
      messageId: 42,
    });

    expect(editMessageTextMock).not.toHaveBeenCalled();
    expect(buscarMock).not.toHaveBeenCalled();
    const textos = sendMessageMock.mock.calls.map((c) => String(c[2]).toLowerCase());
    expect(textos.some((t) => t.includes("expirou"))).toBe(true);
  });

  it("com sessão de OUTRO flow (caça em andamento), também trata como busca expirada", async () => {
    const db = dbSessaoPersistente({
      flow: FLOW_CACA,
      step: "ask_price",
      data: { produto: "air fryer" },
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    await tratar(db, "tok", {
      chatId: 7,
      texto: "pag:5",
      callbackId: "cb1",
      messageId: 42,
    });

    expect(editMessageTextMock).not.toHaveBeenCalled();
    expect(buscarMock).not.toHaveBeenCalled();
    const textos = sendMessageMock.mock.calls.map((c) => String(c[2]).toLowerCase());
    expect(textos.some((t) => t.includes("expirou"))).toBe(true);
  });

  // Trava o `salvarSessao(..., FLOW_BUSCA, ...)` do `/agora`: sem ele a sessão
  // nunca é gravada e o primeiro clique no botão já cai em "busca expirou".
  it("fim a fim: /agora grava a sessão que o botão de paginar consome depois", async () => {
    const db = dbSessaoPersistente(null);
    await tratar(db, "tok", { chatId: 7, texto: "/agora air fryer" });
    sendMessageMock.mockClear();

    await tratar(db, "tok", {
      chatId: 7,
      texto: "pag:5",
      callbackId: "cb1",
      messageId: 42,
    });

    expect(editMessageTextMock).toHaveBeenCalledTimes(1);
    expect(String(editMessageTextMock.mock.calls[0][3])).toContain("Produto 5");
    const textos = sendMessageMock.mock.calls.map((c) => String(c[2]).toLowerCase());
    expect(textos.some((t) => t.includes("expirou"))).toBe(false);
  });

  // Payload do Telegram sem `message` (mensagem velha demais, por exemplo):
  // não dá pra editar, mas o usuário não pode ficar sem resposta.
  it("sem messageId, cai pra mensagem nova em vez de falhar em silêncio", async () => {
    const db = dbSessaoPersistente(sessaoDeBusca("air fryer"));
    await tratar(db, "tok", { chatId: 7, texto: "pag:5", callbackId: "cb1" });

    expect(editMessageTextMock).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(String(sendMessageMock.mock.calls[0][2])).toContain("Produto 5");
  });
});
