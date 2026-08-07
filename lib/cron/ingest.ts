import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchChannelPage } from "@/lib/collector/fetch";
import { parseChannelPage } from "@/lib/collector/parse";
import { advanceCursor, savePosts, selectNewPosts } from "@/lib/db/posts";
import type { ChannelRow } from "@/lib/db/types";

export type IngestReport = {
  slug: string;
  fetched: number;
  saved: number;
  error: string | null;
};

/** Agrega os relatórios por canal. Puro. */
export function summarize(reports: IngestReport[]): {
  total: number;
  saved: number;
  failed: number;
  allEmpty: boolean;
} {
  const total = reports.reduce((n, r) => n + r.fetched, 0);
  const saved = reports.reduce((n, r) => n + r.saved, 0);
  const failed = reports.filter((r) => r.error !== null).length;
  return { total, saved, failed, allEmpty: reports.length > 0 && total === 0 };
}

async function ingestChannel(db: SupabaseClient, channel: ChannelRow): Promise<IngestReport> {
  try {
    const html = await fetchChannelPage(channel.slug);
    const parsed = parseChannelPage(html, channel.slug);
    const fresh = selectNewPosts(parsed, channel.last_post_id);
    const saved = await savePosts(db, channel.slug, fresh);
    await advanceCursor(db, channel.slug, parsed);
    return { slug: channel.slug, fetched: parsed.length, saved, error: null };
  } catch (e) {
    return {
      slug: channel.slug,
      fetched: 0,
      saved: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Coleta todos os canais ativos em paralelo. Um canal quebrado não derruba os outros. */
export async function ingestAll(db: SupabaseClient): Promise<IngestReport[]> {
  const { data, error } = await db.from("channels").select("*").eq("is_active", true);
  if (error) throw new Error(`Lendo canais: ${error.message}`);

  const channels = (data ?? []) as ChannelRow[];
  return Promise.all(channels.map((c) => ingestChannel(db, c)));
}
