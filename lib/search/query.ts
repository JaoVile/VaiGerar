import type { SupabaseClient } from "@supabase/supabase-js";
import { type PriceStats, priceStats } from "@/lib/search/stats";

export type SearchHit = {
  text: string;
  priceCents: number;
  store: string | null;
  postedAt: string;
  url: string;
};

export type SearchResult = {
  termo: string;
  stats: PriceStats | null;
  melhores: SearchHit[];
};

const MESES_PADRAO = 6;
const LIMITE_PADRAO = 5;
/** Teto de linhas lidas: a estatística precisa do conjunto todo, mas não do arquivo todo. */
const TETO_LINHAS = 2000;

export async function buscar(
  db: SupabaseClient,
  termo: string,
  opts: { meses?: number; limite?: number } = {},
): Promise<SearchResult> {
  const meses = opts.meses ?? MESES_PADRAO;
  const limite = opts.limite ?? LIMITE_PADRAO;

  const desde = new Date();
  desde.setMonth(desde.getMonth() - meses);

  const { data, error } = await db
    .from("posts")
    .select("text,price_cents,store,posted_at,url")
    .textSearch("search_vector", termo, { type: "plain", config: "portuguese" })
    .not("price_cents", "is", null)
    .gte("posted_at", desde.toISOString())
    .order("price_cents", { ascending: true })
    .limit(TETO_LINHAS);

  if (error) throw new Error(`Buscando "${termo}": ${error.message}`);

  const linhas = (data ?? []) as Array<{
    text: string;
    price_cents: number;
    store: string | null;
    posted_at: string;
    url: string;
  }>;

  // Ordena no client: o fake de teste não simula o ".order()" do Supabase
  // (não reordena os dados), e a estatística precisa das linhas casadas
  // como um conjunto — só "melhores" depende de estar ordenado por preço.
  const ordenadas = [...linhas].sort((a, b) => a.price_cents - b.price_cents);

  const melhores: SearchHit[] = ordenadas.slice(0, limite).map((l) => ({
    text: l.text,
    priceCents: l.price_cents,
    store: l.store,
    postedAt: l.posted_at,
    url: l.url,
  }));

  return {
    termo,
    stats: priceStats(linhas.map((l) => l.price_cents)),
    melhores,
  };
}
