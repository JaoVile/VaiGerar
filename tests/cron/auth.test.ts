import { describe, expect, it } from "vitest";
import { assertCronAuth } from "@/lib/cron/auth";

const req = (headers: Record<string, string>) => new Request("https://x/", { headers });

describe("assertCronAuth", () => {
  it("aceita o header correto", () => {
    expect(() => assertCronAuth(req({ "x-cron-secret": "s3cr3t" }), "s3cr3t")).not.toThrow();
  });
  it("rejeita header ausente", () => {
    expect(() => assertCronAuth(req({}), "s3cr3t")).toThrow(/não autorizado/i);
  });
  it("rejeita header errado", () => {
    expect(() => assertCronAuth(req({ "x-cron-secret": "outro" }), "s3cr3t")).toThrow();
  });
});
