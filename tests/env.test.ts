import { describe, expect, it } from "vitest";
import { readEnv } from "@/lib/env";

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
