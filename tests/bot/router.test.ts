import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { autorizado, extrairEntrada, tratar } from "@/lib/bot/router";

// Mocka só o I/O do Telegram; `escapeHtml` continua sendo o de verdade —
// é justamente ele que está sob teste no bloco de /cacas abaixo.
const { sendMessageMock, answerCallbackQueryMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
  answerCallbackQueryMock: vi.fn(),
}));
vi.mock("@/lib/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/telegram")>()),
  sendMessage: sendMessageMock,
  answerCallbackQuery: answerCallbackQueryMock,
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

const hunt = (label: string) => ({
  id: "11111111-1111-1111-1111-111111111111",
  label,
  price_min_cents: 285000,
  price_max_cents: 315000,
  is_active: true,
});

describe("tratar /cacas", () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    answerCallbackQueryMock.mockReset();
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
});
