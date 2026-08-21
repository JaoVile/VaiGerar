import { describe, expect, it } from "vitest";
import type { StoredRun } from "@/lib/db/runs";
import { ATRASO_MIN, alturaBarra, avaliarSaude, minutosDesde, totais } from "@/lib/painel";

const AGORA = new Date("2026-08-21T12:00:00Z");

function run(over: Partial<StoredRun> = {}): StoredRun {
  return {
    id: 1,
    kind: "tick",
    started_at: new Date(AGORA.getTime() - 60_000).toISOString(),
    finished_at: AGORA.toISOString(),
    duration_ms: 4000,
    channels: 3,
    fetched: 30,
    saved: 5,
    failed: 0,
    all_empty: false,
    alerts_matched: 0,
    alerts_sent: 0,
    alerts_failed: 0,
    alerts_deferred: 0,
    error: null,
    reports: [{ slug: "a", fetched: 30, saved: 5, error: null }],
    status: "ok",
    ...over,
  };
}

/** Rodada com N minutos de idade. */
const haMinutos = (n: number, over: Partial<StoredRun> = {}) =>
  run({ started_at: new Date(AGORA.getTime() - n * 60_000).toISOString(), ...over });

describe("avaliarSaude", () => {
  it("sem rodada nenhuma, diz que não há dado — não que está tudo bem", () => {
    expect(avaliarSaude([], AGORA).status).toBe("sem-dados");
  });

  it("rodada recente e limpa é ok", () => {
    expect(avaliarSaude([haMinutos(2)], AGORA).status).toBe("ok");
  });

  it("PARADO tem precedência sobre uma última rodada verde", () => {
    // O ponto do painel. Uma rodada 'ok' de três horas atrás não é boa
    // notícia: é a última coisa que funcionou antes do agendador morrer.
    // Se o verde ganhasse aqui, o modo de falha mais silencioso do sistema
    // — cron externo desligado — apareceria como "tudo certo".
    const saude = avaliarSaude([haMinutos(180, { status: "ok" })], AGORA);
    expect(saude.status).toBe("parado");
    expect(saude.detalhe).toMatch(/180 min/);
  });

  it("tolera jitter do agendador externo antes de gritar", () => {
    // Alarme que dispara com atraso normal é alarme que se aprende a ignorar.
    expect(avaliarSaude([haMinutos(ATRASO_MIN - 1)], AGORA).status).toBe("ok");
    expect(avaliarSaude([haMinutos(ATRASO_MIN + 1)], AGORA).status).toBe("parado");
  });

  it("canário recente é quebrado, e explica o motivo provável", () => {
    const saude = avaliarSaude([haMinutos(1, { status: "canary", all_empty: true })], AGORA);
    expect(saude.status).toBe("quebrado");
    expect(saude.detalhe).toMatch(/t\.me/);
  });

  it("degradado nomeia os canais que falharam", () => {
    const saude = avaliarSaude(
      [
        haMinutos(1, {
          status: "degraded",
          channels: 3,
          failed: 2,
          reports: [
            { slug: "ok1", fetched: 5, saved: 1, error: null },
            { slug: "morto1", fetched: 0, saved: 0, error: "404" },
            { slug: "morto2", fetched: 0, saved: 0, error: "timeout" },
          ],
        }),
      ],
      AGORA,
    );
    expect(saude.status).toBe("degradado");
    expect(saude.detalhe).toContain("morto1");
    expect(saude.detalhe).toContain("morto2");
    expect(saude.detalhe).not.toContain("ok1");
  });

  it("ignora rodadas de outros kinds ao julgar o coletor", () => {
    // Uma purga bem-sucedida agora não diz nada sobre o tick estar coletando.
    const saude = avaliarSaude(
      [run({ kind: "purge", started_at: AGORA.toISOString() }), haMinutos(200)],
      AGORA,
    );
    expect(saude.status).toBe("parado");
  });

  it("erro de rodada inteira aparece com a mensagem original", () => {
    const saude = avaliarSaude(
      [haMinutos(1, { status: "error", error: "connection refused" })],
      AGORA,
    );
    expect(saude.status).toBe("quebrado");
    expect(saude.detalhe).toBe("connection refused");
  });
});

describe("totais", () => {
  it("soma só as rodadas de tick", () => {
    const t = totais([
      run({ id: 1, fetched: 10, saved: 2, alerts_sent: 1 }),
      run({ id: 2, fetched: 5, saved: 1, alerts_sent: 2 }),
      run({ id: 3, kind: "purge", fetched: 999, saved: 999, alerts_sent: 999 }),
    ]);
    expect(t.rodadas).toBe(2);
    expect(t.fetched).toBe(15);
    expect(t.saved).toBe(3);
    expect(t.alertas).toBe(3);
  });

  it("conta como problema tudo que não for ok", () => {
    const t = totais([
      run({ id: 1, status: "ok" }),
      run({ id: 2, status: "degraded" }),
      run({ id: 3, status: "canary" }),
      run({ id: 4, status: "error" }),
    ]);
    expect(t.falhas).toBe(3);
  });

  it("não divide por zero sem rodada", () => {
    expect(totais([]).duracaoMedia).toBe(0);
  });
});

describe("alturaBarra", () => {
  it("rodada que salvou zero ainda desenha um traço", () => {
    // Sumir da faixa seria a mesma coisa que não ter acontecido — e ela
    // aconteceu. Um tick que não trouxe nada é informação.
    expect(alturaBarra(0, 50)).toBeGreaterThan(0);
  });

  it("é proporcional ao maior valor da janela", () => {
    expect(alturaBarra(50, 50)).toBe(1);
    expect(alturaBarra(25, 50)).toBe(0.5);
  });

  it("aguenta uma janela inteira de zeros", () => {
    expect(alturaBarra(0, 0)).toBeGreaterThan(0);
    expect(alturaBarra(0, 0)).toBeLessThan(0.1);
  });
});

describe("minutosDesde", () => {
  it("mede a partir do agora recebido, não do relógio", () => {
    expect(minutosDesde(new Date(AGORA.getTime() - 300_000).toISOString(), AGORA)).toBe(5);
  });
});
