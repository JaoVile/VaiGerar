"use client";

import { useState } from "react";
import type { StoredRun } from "@/lib/db/runs";
import { alturaBarra, formatarDataHora, formatarDuracao, formatarHora } from "@/lib/painel";

const ROTULO: Record<string, string> = {
  ok: "ok",
  degraded: "degradado",
  canary: "canário",
  error: "erro",
};

/**
 * A faixa e a tabela compartilham seleção: clicar numa barra abre a rodada
 * correspondente. Sem isso a faixa vira decoração — ela existe pra achar a
 * rodada estranha, não pra ser bonita.
 */
export function Rodadas({ runs }: { runs: StoredRun[] }) {
  const [aberta, setAberta] = useState<number | null>(null);

  if (runs.length === 0) {
    return (
      <p className="empty">
        Nenhuma rodada registrada. O log começa a encher no primeiro tick depois de aplicar a
        migração <code>0009_tick_runs.sql</code>.
      </p>
    );
  }

  const maximo = Math.max(...runs.map((r) => r.saved));
  // Mais antiga à esquerda: o tempo anda pra direita.
  const faixa = [...runs].reverse();

  return (
    <>
      <div className="strip">
        {faixa.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`bar ${r.status}`}
            style={{ height: `${alturaBarra(r.saved, maximo) * 100}%` }}
            aria-pressed={aberta === r.id}
            onClick={() => setAberta((id) => (id === r.id ? null : r.id))}
            title={`${formatarHora(r.started_at)} — ${r.saved} novos, ${ROTULO[r.status]}`}
          >
            <span style={{ position: "absolute", left: -9999 }}>
              {formatarHora(r.started_at)}: {r.saved} posts novos, {ROTULO[r.status]}
            </span>
          </button>
        ))}
      </div>

      <div className="scroll-x" style={{ marginTop: 20 }}>
        <table>
          <thead>
            <tr>
              <th>Início</th>
              <th>Duração</th>
              <th>Canais</th>
              <th>Lidos</th>
              <th>Novos</th>
              <th>Alertas</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const falhos = r.reports.filter((x) => x.error !== null);
              const produtivos = r.reports.filter((x) => x.error === null && x.saved > 0);
              return (
                <tr key={r.id}>
                  <td className="num">
                    <button
                      type="button"
                      onClick={() => setAberta((id) => (id === r.id ? null : r.id))}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: "var(--bone)",
                        font: "inherit",
                        cursor: "pointer",
                      }}
                      aria-expanded={aberta === r.id}
                    >
                      {formatarDataHora(r.started_at)}{" "}
                      <span style={{ color: "var(--faint)" }}>{aberta === r.id ? "▾" : "▸"}</span>
                    </button>

                    {aberta === r.id && (
                      <div style={{ marginTop: 10, paddingBottom: 4 }}>
                        {r.error && <p className="err">{r.error}</p>}
                        <div className="chips" style={{ marginTop: 6 }}>
                          {r.reports.length === 0 && !r.error && (
                            <span className="chip zero">sem canais ativos</span>
                          )}
                          {r.reports.map((c) => (
                            <span
                              key={c.slug}
                              className={`chip ${c.error ? "bad" : c.saved > 0 ? "good" : "zero"}`}
                              title={c.error ?? `${c.fetched} lidos, ${c.saved} novos`}
                            >
                              {c.slug} {c.error ? "✕" : `+${c.saved}`}
                            </span>
                          ))}
                        </div>
                        {falhos.map((c) => (
                          <p key={c.slug} className="err" style={{ marginTop: 6 }}>
                            {c.slug}: {c.error}
                          </p>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="num dim">{formatarDuracao(r.duration_ms)}</td>
                  <td className="num">
                    {r.channels - r.failed}
                    <span style={{ color: "var(--faint)" }}>/{r.channels}</span>
                  </td>
                  <td className="num dim">{r.fetched}</td>
                  <td
                    className="num"
                    style={{ color: r.saved > 0 ? "var(--signal)" : "var(--faint)" }}
                  >
                    {r.saved}
                  </td>
                  <td
                    className="num"
                    style={{ color: r.alerts_sent > 0 ? "var(--ember)" : "var(--faint)" }}
                  >
                    {r.alerts_sent}
                    {r.alerts_failed > 0 && (
                      <span style={{ color: "var(--crit)" }}> !{r.alerts_failed}</span>
                    )}
                  </td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <span className={`dot dot-${r.status}`} aria-hidden />
                      <span
                        className="mono"
                        style={{
                          fontSize: 11.5,
                          color: r.status === "ok" ? "var(--mute)" : "var(--warn)",
                        }}
                      >
                        {ROTULO[r.status]}
                      </span>
                      {produtivos.length === 0 && r.status === "ok" && (
                        <span className="chip zero">nada novo</span>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
