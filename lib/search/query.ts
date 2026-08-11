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

/**
 * Janela padrão de busca. Precisa andar junto com `BACKFILL_MONTHS`
 * (`lib/cron/backfill.ts`) e `PURGE_MONTHS` (`lib/cron/purge.ts`): busca,
 * backfill e purga têm que concordar na mesma janela rolante — buscar além
 * do que a purga mantém mostraria "não achei" pra dado que na verdade só foi
 * apagado.
 */
export const MESES_PADRAO = 3;
const LIMITE_PADRAO = 5;
/**
 * Teto de linhas lidas: a estatística precisa do conjunto casado, mas não do
 * arquivo todo. Para o corte fazer sentido ele tem que ser uma *amostra
 * neutra* — por isso a consulta não pede ordenação ao banco (ver abaixo).
 */
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

  // Sem `.order()` de propósito. Com `order("price_cents", asc) + limit(2000)`
  // o banco devolvia os 2000 posts *mais baratos* que casaram — e a
  // estatística calculada em cima disso enviesava sozinha: a mediana virava a
  // mediana da cauda barata e `maxCents` era o 2000º mais barato, não o maior
  // preço real. Isso alimenta o `/agora` e ancora o preço-alvo do `/cacar`.
  // Sem ordenação, o corte de 2000 é uma amostra neutra do conjunto casado;
  // a ordenação por preço, que só `melhores` precisa, é feita no cliente logo
  // abaixo, sobre essas mesmas linhas.
  const { data, error } = await db
    .from("posts")
    .select("text,price_cents,store,posted_at,url")
    .textSearch("search_vector", termo, { type: "plain", config: "portuguese" })
    .not("price_cents", "is", null)
    .gte("posted_at", desde.toISOString())
    .limit(TETO_LINHAS);

  if (error) throw new Error(`Buscando "${termo}": ${error.message}`);

  const linhas = (data ?? []) as Array<{
    text: string;
    price_cents: number;
    store: string | null;
    posted_at: string;
    url: string;
  }>;

  // Só "melhores" depende da ordem; a estatística usa `linhas` como conjunto.
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
