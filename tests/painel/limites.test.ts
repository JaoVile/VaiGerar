import { describe, expect, it } from "vitest";
import type { StoredRun } from "@/lib/db/runs";
import {
  ALVO_OCUPACAO,
  type ArchiveUsage,
  avaliarDisco,
  bytesPorPost,
  custoDoCanal,
  DIAS_RETENCAO,
  formatarBytes,
  limitesDeColeta,
  projetarPlato,
  TETO_DISCO_BYTES,
} from "@/lib/limites";

const MB = 1024 * 1024;

function uso(over: Partial<ArchiveUsage> = {}): ArchiveUsage {
  return {
    posts_total: 100_000,
    bytes_posts: 140 * MB,
    bytes_db: 160 * MB,
    posts_por_dia: 400,
    post_mais_antigo: "2026-05-21T00:00:00Z",
    canais_ativos: 25,
    ...over,
  };
}

function run(over: Partial<StoredRun> = {}): StoredRun {
  return {
    id: 1,
    kind: "tick",
    started_at: "2026-08-21T12:00:00Z",
    finished_at: "2026-08-21T12:00:04Z",
    duration_ms: 4000,
    channels: 25,
    fetched: 300,
    saved: 12,
    failed: 0,
    all_empty: false,
    alerts_matched: 0,
    alerts_sent: 0,
    alerts_failed: 0,
    alerts_deferred: 0,
    error: null,
    reports: [{ slug: "a", fetched: 20, saved: 2, error: null }],
    status: "ok",
    ...over,
  };
}

describe("bytesPorPost", () => {
  it("mede em vez de estimar", () => {
    expect(bytesPorPost(uso({ posts_total: 100, bytes_posts: 140_000 }))).toBe(1400);
  });

  it("arquivo vazio não divide por zero", () => {
    expect(bytesPorPost(uso({ posts_total: 0, bytes_posts: 0 }))).toBe(1400);
  });
});

describe("projetarPlato", () => {
  it("é ritmo x retenção x custo do post, não o tamanho de hoje", () => {
    const u = uso({ posts_total: 1000, bytes_posts: 1000 * 1400, posts_por_dia: 400 });
    expect(projetarPlato(u)).toBe(400 * DIAS_RETENCAO * 1400);
  });

  it("arquivo novo e pequeno já acusa o platô que vem", () => {
    // Três dias de vida: ocupa 20 MB (4% do plano) e mesmo assim o ritmo
    // projeta 75% no platô. É o caso que olhar só o disco de hoje não pega.
    const u = uso({
      posts_total: 9000,
      bytes_posts: 12 * MB,
      bytes_db: 20 * MB,
      posts_por_dia: 3000,
    });
    expect(avaliarDisco(u).usadoPct).toBeLessThan(0.05);
    expect(avaliarDisco(u).platoPct).toBeGreaterThan(ALVO_OCUPACAO);
    expect(avaliarDisco(u).tom).toBe("warn");
  });
});

describe("avaliarDisco", () => {
  it("no ritmo da 0006 (25 canais) o platô cabe no alvo", () => {
    const o = avaliarDisco(uso({ posts_por_dia: 400 }));
    expect(o.platoPct).toBeLessThan(ALVO_OCUPACAO);
    expect(o.tom).toBe("ok");
    expect(o.folgaPostsPorDia).toBeGreaterThan(0);
  });

  it("avisa antes de estourar, não depois", () => {
    const porPost = 1400;
    const noAlvo = (TETO_DISCO_BYTES * ALVO_OCUPACAO) / (DIAS_RETENCAO * porPost);
    const u = uso({ posts_total: 1000, bytes_posts: 1000 * porPost, posts_por_dia: noAlvo * 1.05 });
    expect(avaliarDisco(u).tom).toBe("warn");
    expect(avaliarDisco(u).folgaPostsPorDia).toBe(0);
  });

  it("o tom vem do platô, não do disco de hoje", () => {
    // Disco quase cheio hoje, mas a purga já vai derrubar: platô pequeno.
    const o = avaliarDisco(uso({ bytes_db: 480 * MB, posts_por_dia: 50 }));
    expect(o.usadoPct).toBeGreaterThan(0.9);
    expect(o.tom).toBe("ok");
  });
});

describe("custoDoCanal", () => {
  it("responde quanto do plano o canal come no platô", () => {
    const u = uso({ posts_total: 1000, bytes_posts: 1000 * 1400 });
    const pct = custoDoCanal(400, u);
    expect(pct).toBeCloseTo((400 * DIAS_RETENCAO * 1400) / TETO_DISCO_BYTES, 6);
  });

  it("o ofertasdodia da 0003 (1.920 posts/dia) come metade do plano sozinho", () => {
    // A 0003 o deixou de fora por sinal (repost polui a mediana); este é o
    // outro lado da mesma decisão, agora medido em disco.
    expect(custoDoCanal(1920, uso())).toBeGreaterThan(0.45);
  });
});

describe("limitesDeColeta", () => {
  it("sem rodada não inventa número", () => {
    expect(limitesDeColeta([])).toMatchObject({ duracaoP95Ms: 0, tom: "ok" });
  });

  it("uma rodada perto do teto acende o alarme, mesmo com p95 tranquilo", () => {
    const rodadas = [
      ...Array.from({ length: 19 }, (_, i) => run({ id: i, duration_ms: 3000 })),
      run({ id: 99, duration_ms: 55_000 }),
    ];
    const c = limitesDeColeta(rodadas);
    // p95 de 20 amostras descarta o outlier por definição — por isso o tom
    // não sai dele.
    expect(c.duracaoP95Ms).toBe(3000);
    expect(c.duracaoMaxMs).toBe(55_000);
    expect(c.tom).toBe("crit");
  });

  it("ignora rodada que não é tick", () => {
    const c = limitesDeColeta([run({ kind: "purge", duration_ms: 59_000 }), run({ id: 2 })]);
    expect(c.duracaoMaxMs).toBe(4000);
    expect(c.tom).toBe("ok");
  });

  it("maior leitura de canal sai dos relatórios, não do total da rodada", () => {
    const c = limitesDeColeta([
      run({
        fetched: 300,
        reports: [
          { slug: "a", fetched: 20, saved: 1, error: null },
          { slug: "b", fetched: 97, saved: 3, error: null },
        ],
      }),
    ]);
    expect(c.maiorLeituraCanal).toBe(97);
  });
});

describe("formatarBytes", () => {
  it("escala sem virar 0,0 MB nem 512000 B", () => {
    expect(formatarBytes(900)).toBe("900 B");
    expect(formatarBytes(2048)).toBe("2.0 KB");
    expect(formatarBytes(5 * MB)).toBe("5.0 MB");
    expect(formatarBytes(TETO_DISCO_BYTES)).toBe("500.0 MB");
  });
});
