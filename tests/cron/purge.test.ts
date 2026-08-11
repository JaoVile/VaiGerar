import { describe, expect, it } from "vitest";
import { corteDePurga, purgarLote } from "@/lib/cron/purge";
import { argsDe, createQueryFake } from "@/tests/helpers/fake-db";

const AGORA = new Date("2026-08-11T12:00:00.000Z");

describe("corteDePurga", () => {
  it("com a janela padrão (3 meses), recua 3 meses a partir de `agora`", () => {
    expect(corteDePurga(AGORA)).toEqual(new Date("2026-05-11T12:00:00.000Z"));
  });

  it("aceita uma janela custom em meses", () => {
    expect(corteDePurga(AGORA, 1)).toEqual(new Date("2026-07-11T12:00:00.000Z"));
    expect(corteDePurga(AGORA, 6)).toEqual(new Date("2026-02-11T12:00:00.000Z"));
  });

  it("não muta o `agora` recebido", () => {
    const agora = new Date(AGORA);
    corteDePurga(agora);
    expect(agora).toEqual(AGORA);
  });
});

describe("purgarLote", () => {
  it("apaga posts mais velhos que o corte, ordenando por id e limitando ao tamanho do lote", async () => {
    const db = createQueryFake({
      delete: { posts: [{ id: 1 }, { id: 2 }] },
    });
    const r = await purgarLote(db.client, AGORA, 3, 1000);

    expect(r).toEqual({ apagados: 2, fim: true });

    const del = db.de("delete", "posts")[0];
    expect(argsDe(del, "lt")).toEqual(["posted_at", "2026-05-11T12:00:00.000Z"]);
    expect(argsDe(del, "order")).toEqual(["id", { ascending: true }]);
    expect(argsDe(del, "limit")).toEqual([1000]);
    expect(argsDe(del, "select")).toEqual(["id"]);
  });

  it("usa a janela de retenção padrão (PURGE_MONTHS) quando `meses` não é passado", async () => {
    const db = createQueryFake({ delete: { posts: [] } });
    await purgarLote(db.client, AGORA);

    const del = db.de("delete", "posts")[0];
    // PURGE_MONTHS = 3
    expect(argsDe(del, "lt")).toEqual(["posted_at", "2026-05-11T12:00:00.000Z"]);
  });

  it("`fim` é `false` quando o lote apagou exatamente o tamanho pedido — pode sobrar mais", async () => {
    const linhas = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
    const db = createQueryFake({ delete: { posts: linhas } });
    const r = await purgarLote(db.client, AGORA, 3, 5);

    expect(r).toEqual({ apagados: 5, fim: false });
  });

  it("`fim` é `true` quando o lote apagou menos que o tamanho pedido", async () => {
    const linhas = Array.from({ length: 4 }, (_, i) => ({ id: i + 1 }));
    const db = createQueryFake({ delete: { posts: linhas } });
    const r = await purgarLote(db.client, AGORA, 3, 5);

    expect(r).toEqual({ apagados: 4, fim: true });
  });

  it("lote vazio conta como fim: apagados 0, fim true", async () => {
    const db = createQueryFake({ delete: { posts: [] } });
    const r = await purgarLote(db.client, AGORA, 3, 1000);

    expect(r).toEqual({ apagados: 0, fim: true });
  });

  it("erro do banco vira exceção com o texto original preservado", async () => {
    const db = createQueryFake({ erros: { "delete:posts": "conexão caiu" } });
    await expect(purgarLote(db.client, AGORA)).rejects.toThrow("conexão caiu");
  });
});
