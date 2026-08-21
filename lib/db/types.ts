export type ChannelRow = {
  slug: string;
  title: string | null;
  /** As cinco categorias que `channels_kind_check` aceita desde a 0003. */
  kind: "tech" | "china" | "moda" | "casa" | "geral";
  is_active: boolean;
  last_post_id: number;
  backfill_cursor: number | null;
  backfill_complete: boolean;
};

export type PostRow = {
  channel_slug: string;
  post_id: number;
  posted_at: string;
  text: string;
  url: string;
  price_cents: number | null;
  prices_cents: number[];
  store: string | null;
  product_url: string | null;
};
