import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedPost } from "@/lib/collector/parse";
import type { PostRow } from "@/lib/db/types";

/** Posts além do cursor do canal. Puro. */
export function selectNewPosts(posts: ParsedPost[], lastPostId: number): ParsedPost[] {
  return posts.filter((p) => p.postId > lastPostId);
}

/** ParsedPost → linha da tabela. Puro. */
export function toPostRows(posts: ParsedPost[], slug: string): PostRow[] {
  return posts.map((p) => ({
    channel_slug: slug,
    post_id: p.postId,
    posted_at: p.postedAt,
    text: p.text,
    url: p.url,
    price_cents: p.priceCents,
    prices_cents: p.pricesCents,
    store: p.store,
    product_url: p.productUrl,
  }));
}

/**
 * Grava os posts. Idempotente: o unique (channel_slug, post_id) absorve
 * reprocessamento, então rodar o mesmo tick duas vezes não duplica nada.
 * Devolve quantas linhas foram enviadas.
 */
export async function savePosts(
  db: SupabaseClient,
  slug: string,
  posts: ParsedPost[],
): Promise<number> {
  if (posts.length === 0) return 0;
  const rows = toPostRows(posts, slug);
  const { error } = await db.from("posts").upsert(rows, {
    onConflict: "channel_slug,post_id",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(`Gravando posts de ${slug}: ${error.message}`);
  return rows.length;
}

/** Move last_post_id para o maior id visto. Não retrocede. */
export async function advanceCursor(
  db: SupabaseClient,
  slug: string,
  posts: ParsedPost[],
): Promise<void> {
  if (posts.length === 0) return;
  const maxId = Math.max(...posts.map((p) => p.postId));
  const { error } = await db
    .from("channels")
    .update({ last_post_id: maxId })
    .eq("slug", slug)
    .lt("last_post_id", maxId);
  if (error) throw new Error(`Avançando cursor de ${slug}: ${error.message}`);
}
