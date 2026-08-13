import type { SupabaseClient } from "@supabase/supabase-js";
import { JANELA_HORAS } from "@/lib/cron/alerts";
import { casa, type Hunt } from "@/lib/hunts/match";

/**
 * Menor preço **de pé agora** para cada caça.
 *
 * ## Por que não dava pra reaproveitar o `/cacas`
 *
 * O `/cacas` mostra o menor preço do arquivo de `MESES_PADRAO` meses, que pode
 * ser uma oferta encerrada há semanas — o rodapé dele avisa isso justamente
 * porque a leitura engana. Esta função responde outra pergunta: *o que eu
 * receberia de alerta se ele rodasse agora?*
 *
 * Por isso usa **a mesma janela (`JANELA_HORAS`) e o mesmo `casa()`** do motor
 * de alerta, e não a busca. Se as duas discordassem, o botão viraria mais uma
 * fonte de "achei um preço bom" que nunca vira aviso — que é exatamente a
 * confusão que o rodapé do `/cacas` existe para evitar.
 *
 * ## Uma consulta de posts, não uma por caça
 *
 * O `/cacas` faz uma consulta ao mercado por caça (até 6). Aqui não dá: cada
 * uma varreria as mesmas 48h. Lê a janela uma vez e casa no cliente, que é o
 * mesmo desenho do `processarAlertas`.
 */

const TETO_POSTS = 500;

export type AchadoAtual = {
  priceCents: number;
  store: string | null;
  url: string;
  productUrl: string | null;
  text: string;
  postedAt: string;
};

export type CacaAtual = {
  label: string;
  priceMinCents: number;
  priceMaxCents: number;
  /** `null` quando nada na janela casou — não é erro, é janela vazia. */
  achado: AchadoAtual | null;
};

function toHunt(row: Record<string, unknown>): Hunt {
  return {
    id: row.id as string,
    chatId: 0,
    label: row.label as string,
    query: row.query as string,
    termsAny: (row.terms_any as string[]) ?? [],
    termsNone: (row.terms_none as string[]) ?? [],
    priceMinCents: row.price_min_cents as number,
    priceMaxCents: row.price_max_cents as number,
  };
}

export async function menorAtualPorCaca(
  db: SupabaseClient,
  chatId: number,
  agora: Date = new Date(),
): Promise<CacaAtual[]> {
  const { data: huntRows, error: huntErr } = await db
    .from("hunts")
    .select("id,label,query,terms_any,terms_none,price_min_cents,price_max_cents")
    .eq("chat_id", chatId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (huntErr) throw new Error(`Lendo caças de ${chatId}: ${huntErr.message}`);

  const hunts = (huntRows ?? []).map(toHunt);
  if (hunts.length === 0) return [];

  const desde = new Date(agora.getTime() - JANELA_HORAS * 60 * 60 * 1000).toISOString();
  const { data: postRows, error: postErr } = await db
    .from("posts")
    .select("id,text,price_cents,store,url,product_url,posted_at")
    .not("price_cents", "is", null)
    .gte("posted_at", desde)
    .order("id", { ascending: false })
    .limit(TETO_POSTS);
  if (postErr) throw new Error(`Lendo posts recentes: ${postErr.message}`);

  const posts = (postRows ?? []) as Array<{
    text: string;
    price_cents: number;
    store: string | null;
    url: string;
    product_url: string | null;
    posted_at: string;
  }>;

  return hunts.map((h) => {
    let achado: AchadoAtual | null = null;
    for (const p of posts) {
      if (!casa(p.text, p.price_cents, h)) continue;
      if (achado !== null && achado.priceCents <= p.price_cents) continue;
      achado = {
        priceCents: p.price_cents,
        store: p.store,
        url: p.url,
        productUrl: p.product_url,
        text: p.text,
        postedAt: p.posted_at,
      };
    }
    return {
      label: h.label,
      priceMinCents: h.priceMinCents,
      priceMaxCents: h.priceMaxCents,
      achado,
    };
  });
}
