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

/**
 * Janela quando o usuário também diz o produto (`/cupom mercadolivre ducha`).
 *
 * Maior que a padrão de propósito. Filtrar por produto corta muito: medido em
 * 13/08, "mercadolivre + ducha" rende **1 cupom em 3 dias**, e "amazon +
 * monitor" sai de 2 para 22 ao abrir para 7 dias. Numa consulta ampla a janela
 * curta protege a lista de virar rolo; numa consulta específica ela só
 * devolve vazio.
 *
 * O risco de mostrar cupom mais velho é o mesmo de sempre, e a mensagem já o
 * trata: cada linha diz há quantos dias saiu.
 */
export const DIAS_COM_PRODUTO = 7;

/** Teto de linhas lidas por consulta, no mesmo espírito de `lib/search/query.ts`. */
const TETO_LINHAS = 1500;

export type CupomAchado = Cupom & {
  store: string | null;
  postedAt: string;
  url: string;
};

export type ResultadoCupons = {
  loja: string | null;
  /** Produto pedido junto da loja, quando houver. */
  produto: string | null;
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

/**
 * Separa "mercado livre ducha" em loja e produto.
 *
 * Corta no **maior prefixo que seja uma loja conhecida**, e não no primeiro
 * espaço: várias lojas têm nome de duas palavras ("mercado livre", "magazine
 * luiza", "casas bahia"), e cortar no primeiro espaço transformaria a loja em
 * produto.
 *
 * Se nenhum prefixo for loja conhecida, a entrada inteira continua sendo
 * tratada como loja — é o comportamento antigo, e mantém `/cupom lojinha do
 * zé` respondendo "não achei cupom da lojinha do zé" em vez de inventar que
 * "do zé" é um produto.
 */
export function separarLojaProduto(entrada: string): {
  loja: string;
  produto: string | null;
} {
  const partes = entrada.trim().split(/\s+/).filter(Boolean);
  for (let corte = partes.length; corte > 0; corte--) {
    const candidata = partes.slice(0, corte).join(" ");
    if (APELIDOS[chaveDeLoja(candidata)] === undefined) continue;
    const resto = partes.slice(corte).join(" ");
    return { loja: candidata, produto: resto.length > 0 ? resto : null };
  }
  return { loja: entrada.trim(), produto: null };
}

function chaveDeLoja(entrada: string): string {
  return entrada
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

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
  entrada: string,
  opts: { dias?: number } = {},
): Promise<ResultadoCupons> {
  const { loja: lojaEntrada, produto } = separarLojaProduto(entrada);
  const dias = opts.dias ?? (produto ? DIAS_COM_PRODUTO : DIAS_PADRAO);
  const loja = normalizarLoja(lojaEntrada);
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

  let q = db
    .from("posts")
    .select("text,store,posted_at,url")
    .gte("posted_at", desde)
    .limit(TETO_LINHAS);
  if (loja) q = q.eq("store", loja);
  // Full-text e não `casaTermo`: aqui o alvo é o POST que carrega o cupom, e
  // o cupom raramente cita o produto do jeito exato que o usuário digitou.
  // Ser mais generoso é o certo — a lista já está apertada pela loja.
  if (produto) {
    q = q.textSearch("search_vector", produto, { type: "plain", config: "portuguese" });
  }

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
  return { loja, produto, dias, cupons };
}
