import type { SupabaseClient } from "@supabase/supabase-js";
import { type Cupom, extrairCupons } from "@/lib/parse/coupon";

/**
 * Janela padrão do `/cupom`, em dias.
 *
 * O pedido foi "cupons ativos do dia", mas 24h sozinho não funciona: medido
 * em 12/08, a Amazon rende ~12 cupons distintos por dia e o Mercado Livre
 * ~19, distribuídos ao longo das horas. Um `/cupom amazon` às 9h da manhã com
 * janela de 24h devolveria quase nada, e o comando pareceria quebrado.
 *
 * 3 dias dá corpo à lista sem virar arqueologia. **Validade é impossível de
 * saber** — o post diz o código, não até quando ele vale — então cada linha
 * mostra há quanto tempo foi publicada e o usuário decide.
 */
export const DIAS_PADRAO = 3;

/** Teto de linhas lidas por consulta, no mesmo espírito de `lib/search/query.ts`. */
const TETO_LINHAS = 1500;

export type CupomAchado = Cupom & {
  store: string | null;
  postedAt: string;
  url: string;
};

export type ResultadoCupons = {
  loja: string | null;
  dias: number;
  cupons: CupomAchado[];
};

/**
 * Normaliza o que o usuário digita para o valor gravado em `posts.store`.
 * "mercado livre", "meli" e "ML" são a mesma loja; sem isto o `/cupom mercado
 * livre` não acha nada e o usuário conclui que não tem cupom nenhum.
 */
const APELIDOS: Record<string, string> = {
  ml: "mercadolivre",
  meli: "mercadolivre",
  "mercado livre": "mercadolivre",
  mercadolivre: "mercadolivre",
  amazon: "amazon",
  amzn: "amazon",
  magalu: "magalu",
  magazine: "magalu",
  "magazine luiza": "magalu",
  shopee: "shopee",
  kabum: "kabum",
  aliexpress: "aliexpress",
  ali: "aliexpress",
  samsung: "samsung",
  "casas bahia": "casasbahia",
  casasbahia: "casasbahia",
};

export function normalizarLoja(entrada: string): string | null {
  const chave = entrada
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (chave.length === 0) return null;
  return APELIDOS[chave] ?? chave;
}

export async function buscarCupons(
  db: SupabaseClient,
  lojaEntrada: string,
  opts: { dias?: number } = {},
): Promise<ResultadoCupons> {
  const dias = opts.dias ?? DIAS_PADRAO;
  const loja = normalizarLoja(lojaEntrada);
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

  let q = db
    .from("posts")
    .select("text,store,posted_at,url")
    .gte("posted_at", desde)
    .limit(TETO_LINHAS);
  if (loja) q = q.eq("store", loja);

  const { data, error } = await q;
  if (error) throw new Error(`Buscando cupons de "${lojaEntrada}": ${error.message}`);

  const linhas = (data ?? []) as Array<{
    text: string;
    store: string | null;
    posted_at: string;
    url: string;
  }>;

  // Dedup por código, guardando a ocorrência mais recente: `COMPRINHASPRACASA`
  // aparece 146 vezes no arquivo. Sem isto a primeira página do `/cupom` seria
  // o mesmo código repetido.
  const porCodigo = new Map<string, CupomAchado>();
  for (const l of linhas) {
    for (const c of extrairCupons(l.text)) {
      const anterior = porCodigo.get(c.codigo);
      if (anterior && anterior.postedAt >= l.posted_at) continue;
      porCodigo.set(c.codigo, {
        ...c,
        store: l.store,
        postedAt: l.posted_at,
        url: l.url,
      });
    }
  }

  const cupons = [...porCodigo.values()].sort((a, b) => b.postedAt.localeCompare(a.postedAt));
  return { loja, dias, cupons };
}
