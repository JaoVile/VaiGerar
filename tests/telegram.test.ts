import { afterEach, describe, expect, it, vi } from "vitest";
import {
  editMessageText,
  sendMessage,
  TelegramNotModifiedError,
  TelegramRateLimitError,
} from "@/lib/telegram";

function fakeFetch(status: number, body: string) {
  const spy = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const NAO_MODIFICADA = JSON.stringify({
  ok: false,
  error_code: 400,
  description:
    "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message",
});

describe("editMessageText", () => {
  // O caso real: dois toques rápidos em "mais ofertas". O segundo pede a mesma
  // página, o Telegram devolve 400 "message is not modified" e o botão parava
  // de responder sem explicação nenhuma.
  //
  // Engolir aqui, e não em cada chamador, porque "não modificada" significa que
  // o estado desejado JÁ VALE — é sucesso para qualquer um que peça a edição.
  it("400 'message is not modified' não é erro: o estado desejado já vale", async () => {
    fakeFetch(400, NAO_MODIFICADA);
    await expect(editMessageText("tok", 7, 99, "mesmo texto")).resolves.toBeUndefined();
  });

  it("outros 400 continuam explodindo — não engole erro de verdade", async () => {
    fakeFetch(400, JSON.stringify({ description: "Bad Request: can't parse entities" }));
    await expect(editMessageText("tok", 7, 99, "<b>quebrado")).rejects.toThrow(/parse entities/);
  });

  it("429 continua sendo TelegramRateLimitError, não silêncio", async () => {
    fakeFetch(429, JSON.stringify({ parameters: { retry_after: 30 } }));
    await expect(editMessageText("tok", 7, 99, "oi")).rejects.toBeInstanceOf(
      TelegramRateLimitError,
    );
  });

  it("edição bem-sucedida não lança", async () => {
    fakeFetch(200, JSON.stringify({ ok: true }));
    await expect(editMessageText("tok", 7, 99, "novo texto")).resolves.toBeUndefined();
  });
});

describe("sendMessage", () => {
  // A tolerância é só da edição. Um sendMessage que devolvesse "not modified"
  // seria comportamento inesperado do Telegram, e engolir esconderia isso.
  it("não engole 'not modified' — a tolerância é exclusiva da edição", async () => {
    fakeFetch(400, NAO_MODIFICADA);
    await expect(sendMessage("tok", 7, "oi")).rejects.toBeInstanceOf(TelegramNotModifiedError);
  });
});
