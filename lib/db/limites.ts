import type { SupabaseClient } from "@supabase/supabase-js";
import { menorAtualDeHunts } from "@/lib/hunts/atual";
import type { Hunt } from "@/lib/hunts/match";
import type { ArchiveUsage } from "@/lib/limites";

/** Leituras das vistas da 0010. Nenhuma delas expõe `chat_id`. */

export type HuntFaixa = {
  id: string;
  label: string;
  target_cents: number;
  tolerance_pct: number;
  price_min_cents: number;
  price_max_cents: number;
  last_alert_at: string | null;
  alertas_enviados: number;
  /** Menor preço de pé agora, pela mesma regra do motor de alerta. */
  menorAgoraCents: number | null;
};

export type ChannelFootprint = {
  slug: string;
  title: string | null;
  kind: string;
  is_active: boolean;
  backfill_complete: boolean;
  posts: number;
  ultimo_post_em: string | null;
};

export async function readArchiveUsage(db: SupabaseClient): Promise<ArchiveUsage> {
  const { data, error } = await db.from("archive_usage").select("*").single();
  if (error) throw new Error(`Lendo uso do arquivo: ${error.message}`);
  const u = data as Record<string, unknown>;
  return {
    // `count(*)` e `pg_*_size` voltam como bigint, que o PostgREST serializa
    // em string quando passa de 2^53 — improvável aqui, mas `Number()` é mais
    // barato que descobrir isso em produção.
    posts_total: Number(u.posts_total),
    bytes_posts: Number(u.bytes_posts),
    bytes_db: Number(u.bytes_db),
    posts_por_dia: Number(u.posts_por_dia),
    post_mais_antigo: (u.post_mais_antigo as string) ?? null,
    canais_ativos: Number(u.canais_ativos),
  };
}

export async function readHuntFaixas(
  db: SupabaseClient,
  agora: Date = new Date(),
): Promise<HuntFaixa[]> {
  const { data, error } = await db.from("hunt_faixas").select("*").order("created_at");
  if (error) throw new Error(`Lendo faixas das caças: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const hunts: Hunt[] = rows.map((r) => ({
    id: r.id as string,
    chatId: 0,
    label: r.label as string,
    query: r.query as string,
    termsAny: (r.terms_any as string[]) ?? [],
    termsNone: (r.terms_none as string[]) ?? [],
    priceMinCents: Number(r.price_min_cents),
    priceMaxCents: Number(r.price_max_cents),
  }));

  const atuais = await menorAtualDeHunts(db, hunts, agora);

  return rows.map((r, i) => ({
    id: r.id as string,
    label: r.label as string,
    target_cents: Number(r.target_cents),
    tolerance_pct: Number(r.tolerance_pct),
    price_min_cents: Number(r.price_min_cents),
    price_max_cents: Number(r.price_max_cents),
    last_alert_at: (r.last_alert_at as string) ?? null,
    alertas_enviados: Number(r.alertas_enviados),
    menorAgoraCents: atuais[i]?.achado?.priceCents ?? null,
  }));
}

export async function readChannelFootprint(db: SupabaseClient): Promise<ChannelFootprint[]> {
  const { data, error } = await db.from("channel_footprint").select("*").order("slug");
  if (error) throw new Error(`Lendo canais: ${error.message}`);
  return (data ?? []).map((c: Record<string, unknown>) => ({
    slug: c.slug as string,
    title: (c.title as string) ?? null,
    kind: c.kind as string,
    is_active: c.is_active as boolean,
    backfill_complete: c.backfill_complete as boolean,
    posts: Number(c.posts),
    ultimo_post_em: (c.ultimo_post_em as string) ?? null,
  }));
}
