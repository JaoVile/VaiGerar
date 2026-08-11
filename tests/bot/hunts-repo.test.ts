import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { desativarHunt } from "@/lib/bot/hunts-repo";

function fakeDb(rowsAfetadas: unknown[]) {
  const filtros: Array<[string, unknown]> = [];
  const chain = {
    update: (_patch: Record<string, unknown>) => chain,
    eq: (col: string, val: unknown) => {
      filtros.push([col, val]);
      return chain;
    },
    select: () => Promise.resolve({ data: rowsAfetadas, error: null }),
  };
  return {
    from: () => chain,
    _filtros: filtros,
  } as unknown as SupabaseClient & { _filtros: typeof filtros };
}

describe("desativarHunt", () => {
  it("filtra por id E por chat_id, pra não deixar um chat desativar caça de outro", async () => {
    const db = fakeDb([{ id: "abc" }]);
    await desativarHunt(db, "abc", 7);
    expect(db._filtros).toEqual([
      ["id", "abc"],
      ["chat_id", 7],
    ]);
  });

  it("devolve true quando alguma linha foi desativada", async () => {
    const db = fakeDb([{ id: "abc" }]);
    await expect(desativarHunt(db, "abc", 7)).resolves.toBe(true);
  });

  it("devolve false quando nada casou (id de outro chat, ou inexistente)", async () => {
    const db = fakeDb([]);
    await expect(desativarHunt(db, "abc", 7)).resolves.toBe(false);
  });

  it("propaga erro do banco com o id da caça na mensagem", async () => {
    const chain = {
      update: () => chain,
      eq: () => chain,
      select: () => Promise.resolve({ data: null, error: { message: "boom" } }),
    };
    const db = { from: () => chain } as unknown as SupabaseClient;
    await expect(desativarHunt(db, "abc", 7)).rejects.toThrow(/abc.*boom/);
  });
});
