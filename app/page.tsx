import { AutoRefresh } from "@/components/AutoRefresh";
import { Canais } from "@/components/Canais";
import { Cacas, Coleta, Disco } from "@/components/Limites";
import { Rodadas } from "@/components/Rodadas";
import { createDb } from "@/lib/db/client";
import {
  type ChannelFootprint,
  type HuntFaixa,
  readArchiveUsage,
  readChannelFootprint,
  readHuntFaixas,
} from "@/lib/db/limites";
import { type ChannelHealthRow, listRuns, readChannelHealth, type StoredRun } from "@/lib/db/runs";
import type { ArchiveUsage } from "@/lib/limites";
import { ATRASO_MIN, avaliarSaude, formatarDuracao, minutosDesde, totais } from "@/lib/painel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DOT: Record<string, string> = {
  ok: "dot-ok",
  degradado: "dot-degraded",
  parado: "dot-error",
  quebrado: "dot-canary",
  "sem-dados": "dot-idle",
};

function Figure({
  k,
  v,
  unidade,
  tom,
}: {
  k: string;
  v: string | number;
  unidade?: string;
  tom?: "warn" | "crit";
}) {
  return (
    <div className="figure">
      <div className={`v ${tom ?? ""}`}>
        {v}
        {unidade && <small>{unidade}</small>}
      </div>
      <div className="k label">{k}</div>
    </div>
  );
}

export default async function Painel() {
  const agora = new Date();

  let runs: StoredRun[] = [];
  let health: ChannelHealthRow[] = [];
  let uso: ArchiveUsage | null = null;
  let faixas: HuntFaixa[] = [];
  let canais: ChannelFootprint[] = [];
  let erro: string | null = null;
  let erroLimites: string | null = null;

  // Duas leituras separadas, não um Promise.all só: as vistas da 0010 são
  // novas, e enquanto a migração não roda elas falham. Numa promessa única
  // esse erro apagaria o log de rodadas junto — o painel perderia justamente
  // a tela que já funcionava, por causa de uma seção que ainda não existe.
  try {
    const db = createDb();
    [runs, health] = await Promise.all([listRuns(db, { limit: 120 }), readChannelHealth(db)]);
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  }

  try {
    const db = createDb();
    [uso, faixas, canais] = await Promise.all([
      readArchiveUsage(db),
      readHuntFaixas(db, agora),
      readChannelFootprint(db),
    ]);
  } catch (e) {
    erroLimites = e instanceof Error ? e.message : String(e);
  }

  const saude = avaliarSaude(runs, agora);
  const t = totais(runs);
  const ultimo = runs.find((r) => r.kind === "tick");

  return (
    <main className="wrap">
      <header className="head">
        <div>
          <div className="label">Caçador de Ofertas</div>
          <h1>Rodadas</h1>
          <p className="sub">
            Uma linha por execução do cron: o que cada canal devolveu, o que entrou no banco e
            quantos alertas saíram.
          </p>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <AutoRefresh />
        </div>
      </header>

      {erro && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <header>
            <span className="dot dot-error" aria-hidden />
            <span className="label">Sem acesso ao banco</span>
          </header>
          <div className="body">
            <p className="err">{erro}</p>
            <p className="empty" style={{ marginTop: 10 }}>
              Se a mensagem cita <code>tick_runs</code> ou <code>channel_health</code>, a migração{" "}
              <code>supabase/migrations/0009_tick_runs.sql</code> ainda não foi aplicada.
            </p>
          </div>
        </section>
      )}

      {/* Estado agora. É o que responde "preciso fazer alguma coisa?". */}
      <section className="panel" style={{ marginBottom: 16 }}>
        <header>
          <span className={`dot ${DOT[saude.status]}`} aria-hidden />
          <span className="label">Coletor</span>
          <span className="label" style={{ marginLeft: "auto" }}>
            {ultimo ? `última há ${Math.round(minutosDesde(ultimo.started_at, agora))} min` : "—"}
          </span>
        </header>
        <div className="body">
          <p style={{ fontSize: 15 }}>{saude.detalhe}</p>
          <div className="figures" style={{ marginTop: 18 }}>
            <Figure k="Rodadas na janela" v={t.rodadas} />
            <Figure k="Posts lidos" v={t.fetched.toLocaleString("pt-BR")} />
            <Figure k="Posts novos" v={t.saved.toLocaleString("pt-BR")} />
            <Figure k="Alertas enviados" v={t.alertas} />
            <Figure k="Rodadas com problema" v={t.falhas} tom={t.falhas > 0 ? "warn" : undefined} />
            <Figure k="Duração média" v={formatarDuracao(t.duracaoMedia)} />
          </div>
        </div>
      </section>

      {erroLimites && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <header>
            <span className="dot dot-degraded" aria-hidden />
            <span className="label">Limites e canais indisponíveis</span>
          </header>
          <div className="body">
            <p className="err">{erroLimites}</p>
            <p className="empty" style={{ marginTop: 10 }}>
              As vistas <code>archive_usage</code>, <code>hunt_faixas</code> e{" "}
              <code>channel_footprint</code> vêm da migração{" "}
              <code>supabase/migrations/0010_limites_e_canais.sql</code>. O log de rodadas acima
              continua valendo — só estas seções dependem dela.
            </p>
          </div>
        </section>
      )}

      {uso && <Disco uso={uso} />}

      <div className="grid-2" style={{ marginBottom: 16 }}>
        {erroLimites === null && <Cacas faixas={faixas} />}
        <Coleta runs={runs} />
      </div>

      {erroLimites === null && (
        <div style={{ marginBottom: 16 }}>
          <Canais canais={canais} />
        </div>
      )}

      <div className="grid-2">
        <section className="panel">
          <header>
            <span className="dot dot-ok" aria-hidden />
            <span className="label">Log de rodadas</span>
            <span className="label" style={{ marginLeft: "auto" }}>
              {runs.length} mais recentes
            </span>
          </header>
          <div className="body">
            <Rodadas runs={runs} />
          </div>
        </section>

        <section className="panel">
          <header>
            <span
              className={`dot ${health.some((c) => c.failures > 0) ? "dot-degraded" : "dot-ok"}`}
              aria-hidden
            />
            <span className="label">Canais — últimas 24 h</span>
          </header>
          <div className="body">
            {health.length === 0 ? (
              <p className="empty">Sem rodadas nas últimas 24 horas para agregar.</p>
            ) : (
              <div className="scroll-x">
                <table>
                  <thead>
                    <tr>
                      <th>Canal</th>
                      <th>Lidos</th>
                      <th>Novos</th>
                      <th>Falhas</th>
                      <th>Último post</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health.map((c) => {
                      // Canal que não traz nada há mais que duas rodadas não é
                      // "sem oferta hoje" — é candidato a canal morto.
                      const parado =
                        c.last_productive_at === null ||
                        minutosDesde(c.last_productive_at, agora) > ATRASO_MIN * 6;
                      return (
                        <tr key={c.slug}>
                          <td className="mono" style={{ fontSize: 12.5 }}>
                            <span
                              className={`dot ${c.failures > 0 ? "dot-degraded" : parado ? "dot-idle" : "dot-ok"}`}
                              style={{ marginRight: 8 }}
                              aria-hidden
                            />
                            {c.slug}
                          </td>
                          <td className="num dim">{c.fetched}</td>
                          <td
                            className="num"
                            style={{ color: c.saved > 0 ? "var(--signal)" : "var(--faint)" }}
                          >
                            {c.saved}
                          </td>
                          <td
                            className="num"
                            style={{ color: c.failures > 0 ? "var(--crit)" : "var(--faint)" }}
                          >
                            {c.failures}
                            <span style={{ color: "var(--faint)" }}>/{c.runs}</span>
                          </td>
                          <td className="num dim">
                            {c.last_productive_at
                              ? `há ${Math.round(minutosDesde(c.last_productive_at, agora))} min`
                              : "nada"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
