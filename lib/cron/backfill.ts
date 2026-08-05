import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchChannelPage } from "@/lib/collector/fetch";
import { type ParsedPost, parseChannelPage } from "@/lib/collector/parse";
import { savePosts } from "@/lib/db/posts";
import type { ChannelRow } from "@/lib/db/types";

export const BACKFILL_MONTHS = 6;

export type BackfillDecision = {
	done: boolean;
	reason: string;
	nextCursor: number | null;
};

/** Decide se o backfill do canal acabou. Puro. */
export function decideBackfill(
	posts: ParsedPost[],
	oldestAllowed: Date,
): BackfillDecision {
	if (posts.length === 0) {
		return { done: true, reason: "página vazia", nextCursor: null };
	}
	const oldest = posts.reduce((a, b) => (a.postId <= b.postId ? a : b));
	if (new Date(oldest.postedAt) < oldestAllowed) {
		return { done: true, reason: "passou da janela", nextCursor: null };
	}
	return { done: false, reason: "continua", nextCursor: oldest.postId };
}

export function oldestAllowedFrom(now: Date, months = BACKFILL_MONTHS): Date {
	const d = new Date(now);
	d.setMonth(d.getMonth() - months);
	return d;
}

/**
 * Uma página por canal por invocação — lento de propósito, pra não martelar o t.me.
 * Canal já completo é no-op.
 */
export async function backfillOnce(
	db: SupabaseClient,
	now: Date,
): Promise<string[]> {
	const { data, error } = await db
		.from("channels")
		.select("*")
		.eq("is_active", true)
		.eq("backfill_complete", false);
	if (error) throw new Error(`Lendo canais: ${error.message}`);

	const limite = oldestAllowedFrom(now);
	const log: string[] = [];

	for (const channel of (data ?? []) as ChannelRow[]) {
		try {
			const cursor = channel.backfill_cursor ?? undefined;
			const html = await fetchChannelPage(channel.slug, cursor);
			const posts = parseChannelPage(html, channel.slug);
			await savePosts(db, channel.slug, posts);

			const decision = decideBackfill(posts, limite);
			await db
				.from("channels")
				.update(
					decision.done
						? { backfill_complete: true }
						: { backfill_cursor: decision.nextCursor },
				)
				.eq("slug", channel.slug);

			log.push(`${channel.slug}: ${posts.length} posts, ${decision.reason}`);
		} catch (e) {
			log.push(
				`${channel.slug}: ERRO ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}

	return log;
}
