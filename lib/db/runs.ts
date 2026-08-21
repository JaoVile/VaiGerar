import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestReport } from "@/lib/cron/ingest";

export type RunKind = "tick" | "backfill" | "reprocess" | "purge";
export type RunStatus = "ok" | "degraded" | "canary" | "error";

export type AlertTotals = {
  casados: number;
  enviados: number;
  falhos: number;
  adiados: number;
};

export type RunRow = {
  kind: RunKind;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  channels: number;
  fetched: number;
  saved: number;
  failed: number;
  all_empty: boolean;
  alerts_matched: number;
  alerts_sent: number;
  alerts_failed: number;
  alerts_deferred: number;
  error: string | null;
  reports: IngestReport[];
};

/** Linha completa como o painel lê (inclui o que o banco gera). */
export type StoredRun = RunRow & { id: number; status: RunStatus };

export type ChannelHealthRow = {
  slug: string;
  runs: number;
  failures: number;
  fetched: number;
  saved: number;
  last_productive_at: string | null;
};

const SEM_ALERTAS: AlertTotals = { casados: 0, enviados: 0, falhos: 0, adiados: 0 };

/**
 * Monta a linha da rodada. Pura — recebe os dois instantes em vez de ler o
 * relógio, pelo mesmo motivo de `corteDePurga`: teste que depende de `now()`
 * é teste que falha em fevereiro.
 */
export function toRunRow(input: {
  kind: RunKind;
  startedAt: Date;
  finishedAt: Date;
  reports?: IngestReport[];
  alerts?: AlertTotals;
  error?: string | null;
}): RunRow {
  const reports = input.reports ?? [];
  const alerts = input.alerts ?? SEM_ALERTAS;
  const fetched = reports.reduce((n, r) => n + r.fetched, 0);

  return {
    kind: input.kind,
    started_at: input.startedAt.toISOString(),
    finished_at: input.finishedAt.toISOString(),
    duration_ms: Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime()),
    channels: reports.length,
    fetched,
    saved: reports.reduce((n, r) => n + r.saved, 0),
    failed: reports.filter((r) => r.error !== null).length,
    // Mesma definição de `summarize`: zero canal não é "tudo vazio", é nada
    // pra coletar. Só dispara o canário quando havia canal e nenhum trouxe post.
    all_empty: reports.length > 0 && fetched === 0,
    alerts_matched: alerts.casados,
    alerts_sent: alerts.enviados,
    alerts_failed: alerts.falhos,
    alerts_deferred: alerts.adiados,
    error: input.error ?? null,
    reports,
  };
}

/**
 * Grava a rodada. **Nunca lança.**
 *
 * Observabilidade não pode derrubar o que ela observa: se a escrita do log
 * falhar (tabela ausente porque a migração 0009 ainda não rodou, Supabase
 * fora do ar, coluna nova), o tick precisa continuar coletando e alertando
 * normalmente. O custo de engolir o erro aqui é um buraco no painel; o custo
 * de propagar seria o scheduler tratar a rodada como perdida e o coletor parar
 * de rodar por causa do gráfico.
 */
export async function recordRun(db: SupabaseClient, row: RunRow): Promise<void> {
  try {
    const { error } = await db.from("tick_runs").insert(row);
    if (error) console.error("Registrando rodada no tick_runs:", error.message);
  } catch (e) {
    console.error("Registrando rodada no tick_runs:", e instanceof Error ? e.message : e);
  }
}

/** Rodadas mais recentes, mais nova primeiro. */
export async function listRuns(
  db: SupabaseClient,
  opts: { kind?: RunKind; limit?: number } = {},
): Promise<StoredRun[]> {
  const limite = Math.min(Math.max(opts.limit ?? 60, 1), 500);
  let q = db.from("tick_runs").select("*").order("started_at", { ascending: false }).limit(limite);
  if (opts.kind) q = q.eq("kind", opts.kind);

  const { data, error } = await q;
  if (error) throw new Error(`Lendo tick_runs: ${error.message}`);
  return (data ?? []) as StoredRun[];
}

export async function readChannelHealth(db: SupabaseClient): Promise<ChannelHealthRow[]> {
  const { data, error } = await db.from("channel_health").select("*").order("slug");
  if (error) throw new Error(`Lendo channel_health: ${error.message}`);
  return (data ?? []) as ChannelHealthRow[];
}

/**
 * Purga do próprio log. A retenção é menor que a dos posts de propósito:
 * `PURGE_MONTHS` existe pra manter o arquivo pesquisável por 3 meses, e o
 * log de rodada não é arquivo — passados 14 dias ele já respondeu tudo que
 * tinha pra responder sobre "quando isso quebrou". A 288 rodadas/dia, 14 dias
 * são ~4 mil linhas, que cabem em qualquer plano sem pensar no assunto.
 */
export const RUNS_RETENTION_DAYS = 14;

export function corteDeRodadas(agora: Date, dias: number = RUNS_RETENTION_DAYS): Date {
  const d = new Date(agora);
  d.setDate(d.getDate() - dias);
  return d;
}

export async function purgarRodadas(
  db: SupabaseClient,
  agora: Date,
  dias: number = RUNS_RETENTION_DAYS,
): Promise<number> {
  const corte = corteDeRodadas(agora, dias);
  // Dois passos pelo mesmo motivo documentado em `purgarLote`: o PostgREST
  // ignora `limit` num DELETE. Aqui o volume é pequeno, mas a armadilha é a
  // mesma e não vale deixar uma segunda versão do erro no repositório.
  const { data, error: erroSelect } = await db
    .from("tick_runs")
    .select("id")
    .lt("started_at", corte.toISOString())
    .order("id", { ascending: true })
    .limit(500);
  if (erroSelect) throw new Error(`Selecionando rodadas a purgar: ${erroSelect.message}`);

  const ids = (data ?? []).map((row: { id: number }) => row.id);
  if (ids.length === 0) return 0;

  const { error } = await db.from("tick_runs").delete().in("id", ids);
  if (error) throw new Error(`Purgando rodadas: ${error.message}`);
  return ids.length;
}
