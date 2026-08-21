import { TIMEOUT_MS } from "@/lib/collector/fetch";
import type { HuntFaixa } from "@/lib/db/limites";
import type { StoredRun } from "@/lib/db/runs";
import {
  ALVO_OCUPACAO,
  type ArchiveUsage,
  avaliarDisco,
  DIAS_RETENCAO,
  formatarBytes,
  formatarPct,
  formatarReais,
  limitesDeColeta,
  MAX_DURATION_MS,
  TETO_DISCO_BYTES,
} from "@/lib/limites";
import { formatarDuracao, TICK_INTERVAL_MIN } from "@/lib/painel";

/**
 * Barra de ocupação com duas marcas: onde o arquivo está e onde ele vai
 * parar. Só o "está" seria enganoso — arquivo novo ocupa pouco e mesmo assim
 * pode estar a caminho de estourar.
 */
function Barra({ usadoPct, platoPct }: { usadoPct: number; platoPct: number }) {
  const larg = (f: number) => `${Math.min(100, Math.max(0, f * 100))}%`;
  return (
    <div className="gauge" title={`agora ${formatarPct(usadoPct)}, platô ${formatarPct(platoPct)}`}>
      <div className="gauge-plato" style={{ width: larg(platoPct) }} />
      <div className="gauge-usado" style={{ width: larg(usadoPct) }} />
      <div className="gauge-alvo" style={{ left: larg(ALVO_OCUPACAO) }} />
    </div>
  );
}

export function Disco({ uso }: { uso: ArchiveUsage }) {
  const o = avaliarDisco(uso);
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <header>
        <span
          className={`dot ${o.tom === "crit" ? "dot-error" : o.tom === "warn" ? "dot-degraded" : "dot-ok"}`}
          aria-hidden
        />
        <span className="label">Disco — plano free</span>
        <span className="label" style={{ marginLeft: "auto" }}>
          teto {formatarBytes(TETO_DISCO_BYTES)}
        </span>
      </header>
      <div className="body">
        <Barra usadoPct={o.usadoPct} platoPct={o.platoPct} />
        <p style={{ fontSize: 15, marginTop: 14 }}>{o.detalhe}</p>
        <div className="figures" style={{ marginTop: 18 }}>
          <div className="figure">
            <div className="v">
              {formatarBytes(o.usadoBytes)}
              <small>agora</small>
            </div>
            <div className="k label">Banco inteiro · {formatarPct(o.usadoPct)}</div>
          </div>
          <div className="figure">
            <div className={`v ${o.tom === "ok" ? "" : o.tom}`}>
              {formatarBytes(o.platoBytes)}
              <small>platô</small>
            </div>
            <div className="k label">
              Em {DIAS_RETENCAO} dias · {formatarPct(o.platoPct)}
            </div>
          </div>
          <div className="figure">
            <div className="v">{Math.round(uso.posts_por_dia).toLocaleString("pt-BR")}</div>
            <div className="k label">Posts/dia (7 d)</div>
          </div>
          <div className="figure">
            <div className="v">{Math.round(o.folgaPostsPorDia).toLocaleString("pt-BR")}</div>
            <div className="k label">Folga em posts/dia</div>
          </div>
          <div className="figure">
            <div className="v">{uso.posts_total.toLocaleString("pt-BR")}</div>
            <div className="k label">Posts no arquivo</div>
          </div>
          <div className="figure">
            <div className="v">
              {formatarBytes(uso.posts_total > 0 ? uso.bytes_posts / uso.posts_total : 0)}
            </div>
            <div className="k label">Por post, com índice</div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Cacas({ faixas }: { faixas: HuntFaixa[] }) {
  return (
    <section className="panel">
      <header>
        <span className="dot dot-ok" aria-hidden />
        <span className="label">Faixas das caças</span>
        <span className="label" style={{ marginLeft: "auto" }}>
          {faixas.length} ativas
        </span>
      </header>
      <div className="body">
        {faixas.length === 0 ? (
          <p className="empty">Nenhuma caça ativa. Elas são criadas pelo bot, com /nova.</p>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Caça</th>
                  <th>Piso</th>
                  <th>Alvo</th>
                  <th>Teto</th>
                  <th>Menor agora</th>
                  <th>Alertas</th>
                </tr>
              </thead>
              <tbody>
                {faixas.map((f) => {
                  // A distância até o teto é a resposta de "por que nunca
                  // dispara": as caças reais estão 2% a 7% abaixo do que o
                  // mercado pratica (ver 0008), e sem esta coluna a tela mostra
                  // seis linhas zeradas sem dizer o porquê.
                  const dentro = f.menorAgoraCents !== null;
                  const acima =
                    f.menorAgoraCents === null ? null : f.menorAgoraCents / f.price_max_cents - 1;
                  return (
                    <tr key={f.id}>
                      <td>{f.label}</td>
                      <td className="num dim">{formatarReais(f.price_min_cents)}</td>
                      <td className="num">{formatarReais(f.target_cents)}</td>
                      <td className="num dim">
                        {formatarReais(f.price_max_cents)}
                        <span style={{ color: "var(--faint)" }}> +{f.tolerance_pct}%</span>
                      </td>
                      <td
                        className="num"
                        style={{ color: dentro ? "var(--signal)" : "var(--faint)" }}
                      >
                        {dentro ? formatarReais(f.menorAgoraCents as number) : "nada na janela"}
                        {acima !== null && acima > 0 && (
                          <span style={{ color: "var(--warn)" }}> +{formatarPct(acima)}</span>
                        )}
                      </td>
                      <td
                        className="num"
                        style={{
                          color: f.alertas_enviados > 0 ? "var(--ember)" : "var(--faint)",
                        }}
                      >
                        {f.alertas_enviados}
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
  );
}

export function Coleta({ runs }: { runs: StoredRun[] }) {
  const c = limitesDeColeta(runs);
  return (
    <section className="panel">
      <header>
        <span
          className={`dot ${c.tom === "crit" ? "dot-error" : c.tom === "warn" ? "dot-degraded" : "dot-ok"}`}
          aria-hidden
        />
        <span className="label">Limites da coleta</span>
      </header>
      <div className="body">
        <Barra usadoPct={c.duracaoPct} platoPct={c.duracaoPct} />
        <p style={{ fontSize: 15, marginTop: 14 }}>
          {c.duracaoMaxMs === 0
            ? "Sem rodadas na janela para medir."
            : `Pior rodada da janela: ${formatarDuracao(c.duracaoMaxMs)} do teto de ${formatarDuracao(MAX_DURATION_MS)} da rota (p95 em ${formatarDuracao(c.duracaoP95Ms)}). A Vercel corta a requisição no teto sem deixar linha no log.`}
        </p>
        <div className="figures" style={{ marginTop: 18 }}>
          <div className="figure">
            <div className="v">
              {TICK_INTERVAL_MIN}
              <small>min</small>
            </div>
            <div className="k label">Cadência do tick</div>
          </div>
          <div className="figure">
            <div className="v">{c.canaisNaUltima}</div>
            <div className="k label">Canais na última rodada</div>
          </div>
          <div className="figure">
            <div className="v">{c.maiorLeituraCanal}</div>
            <div className="k label">Maior leitura de canal</div>
          </div>
          <div className="figure">
            <div className={`v ${c.tom === "ok" ? "" : c.tom}`}>{formatarPct(c.duracaoPct)}</div>
            <div className="k label">Da janela da rota</div>
          </div>
          <div className="figure">
            <div className="v">
              {TIMEOUT_MS / 1000}
              <small>s</small>
            </div>
            <div className="k label">Timeout por canal</div>
          </div>
        </div>
      </div>
    </section>
  );
}
