import { afterEach, describe, expect, it, vi } from "vitest";
import { readBotEnv, readEnv } from "@/lib/env";

describe("readEnv", () => {
  it("lê as variáveis quando todas estão presentes", () => {
    const env = readEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "key",
      CRON_SECRET: "secret",
    });
    expect(env.supabaseUrl).toBe("https://x.supabase.co");
    expect(env.cronSecret).toBe("secret");
  });

  it("falha alto quando falta variável, dizendo qual", () => {
    expect(() => readEnv({ SUPABASE_URL: "https://x.supabase.co" })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });
});

const BOT = {
  TELEGRAM_BOT_TOKEN_OFERTAS: "123:abc",
  TELEGRAM_WEBHOOK_SECRET: "wh",
  ALLOWED_CHAT_IDS: "111,222",
};

describe("readBotEnv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lê o token e o segredo do webhook", () => {
    const env = readBotEnv(BOT);
    expect(env.telegramBotToken).toBe("123:abc");
    expect(env.telegramWebhookSecret).toBe("wh");
  });

  it("converte ALLOWED_CHAT_IDS em números", () => {
    expect(readBotEnv(BOT).allowedChatIds).toEqual([111, 222]);
  });

  it("tolera espaços e entradas vazias na lista", () => {
    expect(readBotEnv({ ...BOT, ALLOWED_CHAT_IDS: " 111 , ,222 " }).allowedChatIds).toEqual([
      111, 222,
    ]);
  });

  it("falha nomeando a variável do bot que falta", () => {
    const { TELEGRAM_WEBHOOK_SECRET, ...semSegredo } = BOT;
    expect(() => readBotEnv(semSegredo)).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
  });

  it("avisa no log cada entrada descartada de ALLOWED_CHAT_IDS", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readBotEnv({ ...BOT, ALLOWED_CHAT_IDS: "111,abc,222;333" }).allowedChatIds).toEqual([
      111,
    ]);
    const avisos = warn.mock.calls.map((c) => String(c[0]));
    expect(avisos).toHaveLength(2);
    expect(avisos.join(" ")).toContain("abc");
    expect(avisos.join(" ")).toContain("222;333");
  });

  it("lança quando ALLOWED_CHAT_IDS está presente mas não tem nenhum id válido", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Allowlist vazia faria o bot ignorar tudo em silêncio: é erro de
    // configuração, não "ninguém autorizado".
    expect(() => readBotEnv({ ...BOT, ALLOWED_CHAT_IDS: "meu-chat" })).toThrow(/ALLOWED_CHAT_IDS/);
  });

  it("NÃO exige as variáveis do bot em readEnv — o coletor não depende do bot", () => {
    expect(() =>
      readEnv({
        SUPABASE_URL: "https://x.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "key",
        CRON_SECRET: "secret",
      }),
    ).not.toThrow();
  });
});
