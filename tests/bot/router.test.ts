import { describe, expect, it } from "vitest";
import { autorizado, extrairEntrada } from "@/lib/bot/router";

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
