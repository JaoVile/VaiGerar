import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchChannelPage } from "@/lib/collector/fetch";
import { countPostAnchors, type ParsedPost, parseChannelPage } from "@/lib/collector/parse";
import { savePosts } from "@/lib/db/posts";
import type { ChannelRow } from "@/lib/db/types";

export const BACKFILL_MONTHS = 6;

/** Razão de parada que significa quebra, não fim de arquivo. */
export const PARSER_BROKEN = "parser quebrado";

export type BackfillDecision = {
  done: boolean;
  reason: string;
  nextCursor: number | null;
  /** Quebra de parser: não avança cursor nem marca completo, e a rota grita. */
  broken: boolean;
};

export type BackfillReport = {
  slug: string;
  posts: number;
  reason: string;
  broken: boolean;
  error: string | null;
};

/**
 * Decide se o backfill do canal acabou. Puro.
 *
 * `anchorCount` é quantas âncoras `data-post` a página trazia. Zero post COM
 * âncoras é o t.me tendo mudado o markup interno da mensagem: a página existe,
 * o parser é que parou de ler. Concluir aqui gravaria `backfill_complete = true`
 * — e nada no sistema devolve esse campo pra `false`, então o arquivo histórico
 * ficaria truncado pra sempre. Zero âncora continua sendo fim de arquivo.
 */
export function decideBackfill(
  posts: ParsedPost[],
  oldestAllowed: Date,
  previousCursor?: number,
  anchorCount = 0,
): BackfillDecision {
  if (posts.length === 0) {
    if (anchorCount > 0) {
      return {
        done: false,
        reason: PARSER_BROKEN,
        nextCursor: null,
        broken: true,
      };
    }
    return {
      done: true,
      reason: "página vazia",
      nextCursor: null,
      broken: false,
    };
  }
  const oldest = posts.reduce((a, b) => (a.postId <= b.postId ? a : b));
  if (new Date(oldest.postedAt) < oldestAllowed) {
    return {
      done: true,
      reason: "passou da janela",
      nextCursor: null,
      broken: false,
    };
  }
  const nextCursor = oldest.postId;
  if (previousCursor !== undefined && nextCursor === previousCursor) {
    return {
      done: true,
      reason: "cursor travado",
      nextCursor: null,
      broken: false,
    };
  }
  return { done: false, reason: "continua", nextCursor, broken: false };
}

export function oldestAllowedFrom(now: Date, months = BACKFILL_MONTHS): Date {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d;
}

/** Linha de log de um canal. Puro. */
export function backfillLogLine(r: BackfillReport): string {
  return r.error !== null
    ? `${r.slug}: ERRO ${r.error}`
    : `${r.slug}: ${r.posts} posts, ${r.reason}`;
}

/**
 * Agrega os relatórios por canal. Puro. Mesmo papel de `summarize` no tick.
 *
 * `noneOk` só acende com canais processados: lista vazia é o estado normal de
 * regime (todo canal já com `backfill_complete = true`), não falha.
 */
export function summarizeBackfill(reports: BackfillReport[]): {
  channels: number;
  posts: number;
  ok: number;
  failed: number;
  broken: number;
  noneOk: boolean;
  log: string[];
} {
  const posts = reports.reduce((n, r) => n + r.posts, 0);
  const failed = reports.filter((r) => r.error !== null).length;
  const broken = reports.filter((r) => r.broken).length;
  const ok = reports.filter((r) => r.error === null && !r.broken).length;
  return {
    channels: reports.length,
    posts,
    ok,
    failed,
    broken,
    noneOk: reports.length > 0 && ok === 0,
    log: reports.map(backfillLogLine),
  };
}

/**
 * Uma página por canal por invocação — lento de propósito, pra não martelar o t.me.
 * Canal já completo é no-op.
 */
export async function backfillOnce(db: SupabaseClient, now: Date): Promise<BackfillReport[]> {
  const { data, error } = await db
    .from("channels")
    .select("*")
    .eq("is_active", true)
    .eq("backfill_complete", false);
  if (error) throw new Error(`Lendo canais: ${error.message}`);

  const limite = oldestAllowedFrom(now);
  const reports: BackfillReport[] = [];

  for (const channel of (data ?? []) as ChannelRow[]) {
    try {
      const cursor = channel.backfill_cursor ?? undefined;
      const html = await fetchChannelPage(channel.slug, cursor);
      const posts = parseChannelPage(html, channel.slug);
      await savePosts(db, channel.slug, posts);

      const decision = decideBackfill(
        posts,
        limite,
        channel.backfill_cursor ?? undefined,
        countPostAnchors(html),
      );

      // Parser quebrado: nem avança cursor nem marca completo. Deixar o canal
      // parado no mesmo cursor é reversível — marcar completo não é.
      if (decision.broken) {
        reports.push({
          slug: channel.slug,
          posts: 0,
          reason: decision.reason,
          broken: true,
          error: null,
        });
        continue;
      }

      await db
        .from("channels")
        .update(
          decision.done ? { backfill_complete: true } : { backfill_cursor: decision.nextCursor },
        )
        .eq("slug", channel.slug);

      reports.push({
        slug: channel.slug,
        posts: posts.length,
        reason: decision.reason,
        broken: false,
        error: null,
      });
    } catch (e) {
      reports.push({
        slug: channel.slug,
        posts: 0,
        reason: "erro",
        broken: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return reports;
}
