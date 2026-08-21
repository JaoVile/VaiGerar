import { describe, expect, it, vi } from "vitest";
import type { IngestReport } from "@/lib/cron/ingest";
import { corteDeRodadas, purgarRodadas, recordRun, toRunRow } from "@/lib/db/runs";
import { createQueryFake } from "../helpers/fake-db";

const rel = (over: Partial<IngestReport> = {}): IngestReport => ({
  slug: "canal",
  fetched: 10,
  saved: 3,
  error: null,
  ...over,
});

const INICIO = new Date("2026-08-21T12:00:00Z");
const FIM = new Date("2026-08-21T12:00:04.500Z");

describe("toRunRow", () => {
  it("soma lidos, salvos e falhos dos relatórios", () => {
    const row = toRunRow({
      kind: "tick",
      startedAt: INICIO,
      finishedAt: FIM,
      reports: [
        rel({ slug: "a", fetched: 10, saved: 3 }),
        rel({ slug: "b", fetched: 7, saved: 0 }),
        rel({ slug: "c", fetched: 0, saved: 0, error: "404" }),
      ],
    });

    expect(row.channels).toBe(3);
    expect(row.fetched).toBe(17);
    expect(row.saved).toBe(3);
    expect(row.failed).toBe(1);
    expect(row.duration_ms).toBe(4500);
  });

  it("marca all_empty quando havia canal e nenhum trouxe post", () => {
    const row = toRunRow({
      kind: "tick",
      startedAt: INICIO,
      finishedAt: FIM,
      reports: [rel({ fetched: 0, saved: 0 }), rel({ fetched: 0, saved: 0 })],
    });
    expect(row.all_empty).toBe(true);
  });

  it("NÃO marca all_empty quando não havia canal nenhum", () => {
    // Zero canal ativo não é o canário disparando — é nada pra coletar. Se
    // isto virasse `true`, desativar todos os canais acenderia alarme de
    // "t.me mudou o HTML", que é diagnóstico errado.
    const row = toRunRow({ kind: "tick", startedAt: INICIO, finishedAt: FIM, reports: [] });
    expect(row.all_empty).toBe(false);
  });

  it("não marca all_empty se um único canal trouxe post", () => {
    const row = toRunRow({
      kind: "tick",
      startedAt: INICIO,
      finishedAt: FIM,
      reports: [rel({ fetched: 0, saved: 0 }), rel({ fetched: 1, saved: 0 })],
    });
    expect(row.all_empty).toBe(false);
  });

  it("guarda os totais de alerta sem nenhum dado de pessoa", () => {
    const row = toRunRow({
      kind: "tick",
      startedAt: INICIO,
      finishedAt: FIM,
      reports: [rel()],
      alerts: { casados: 5, enviados: 4, falhos: 1, adiados: 2 },
    });

    expect(row.alerts_matched).toBe(5);
    expect(row.alerts_sent).toBe(4);
    expect(row.alerts_failed).toBe(1);
    expect(row.alerts_deferred).toBe(2);
    // A tabela é pública dentro do projeto e o painel a mostra inteira:
    // hunt_id ou chat_id aqui vazariam pra tela.
    expect(JSON.stringify(row)).not.toMatch(/chat_id|hunt_id/);
  });

  it("nunca devolve duração negativa se os relógios discordarem", () => {
    const row = toRunRow({ kind: "tick", startedAt: FIM, finishedAt: INICIO });
    expect(row.duration_ms).toBe(0);
  });

  it("registra a rodada que morreu antes de coletar", () => {
    const row = toRunRow({
      kind: "tick",
      startedAt: INICIO,
      finishedAt: FIM,
      error: "Lendo canais: connection refused",
    });
    expect(row.error).toBe("Lendo canais: connection refused");
    expect(row.channels).toBe(0);
    expect(row.all_empty).toBe(false);
  });
});

describe("recordRun", () => {
  it("grava a linha na tick_runs", async () => {
    const fake = createQueryFake();
    await recordRun(fake.client, toRunRow({ kind: "tick", startedAt: INICIO, finishedAt: FIM }));

    const inserts = fake.queries.filter((q) => q.op === "insert" && q.table === "tick_runs");
    expect(inserts).toHaveLength(1);
  });

  it("engole erro do banco em vez de derrubar o tick", async () => {
    // Este é o ponto do módulo inteiro. Se a migração 0009 não rodou, a
    // escrita falha — e o coletor precisa continuar coletando e alertando.
    // Observabilidade não pode derrubar o que ela observa.
    const fake = createQueryFake({ erros: { "insert:tick_runs": "relation does not exist" } });
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      recordRun(fake.client, toRunRow({ kind: "tick", startedAt: INICIO, finishedAt: FIM })),
    ).resolves.toBeUndefined();

    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it("engole exceção lançada pelo cliente", async () => {
    const quebrado = {
      from: () => {
        throw new Error("socket hang up");
      },
    } as never;
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      recordRun(quebrado, toRunRow({ kind: "tick", startedAt: INICIO, finishedAt: FIM })),
    ).resolves.toBeUndefined();

    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });
});

describe("corteDeRodadas", () => {
  it("recua os dias pedidos a partir do agora recebido", () => {
    expect(corteDeRodadas(new Date("2026-08-21T12:00:00Z"), 14).toISOString()).toBe(
      "2026-08-07T12:00:00.000Z",
    );
  });
});

describe("purgarRodadas", () => {
  it("não apaga nada quando não há rodada velha", async () => {
    const fake = createQueryFake({ select: { tick_runs: [] } });
    expect(await purgarRodadas(fake.client, new Date("2026-08-21T12:00:00Z"))).toBe(0);
    expect(fake.de("delete", "tick_runs")).toHaveLength(0);
  });

  it("seleciona antes de apagar, e apaga por lista de id", async () => {
    // Dois passos, não um DELETE com limit: o PostgREST ignora `limit` em
    // DELETE — verificado em produção em 2026-08-10 (ver `purgarLote`).
    const fake = createQueryFake({ select: { tick_runs: [{ id: 1 }, { id: 2 }] } });
    const apagados = await purgarRodadas(fake.client, new Date("2026-08-21T12:00:00Z"));

    expect(apagados).toBe(2);
    const del = fake.de("delete", "tick_runs")[0];
    const emIds = del.calls.find((c) => c.method === "in");
    expect(emIds?.args[1]).toEqual([1, 2]);
    expect(del.calls.some((c) => c.method === "limit")).toBe(false);
  });
});
