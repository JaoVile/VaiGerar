import type { SupabaseClient } from "@supabase/supabase-js";
import { tituloDoPost } from "@/lib/bot/format";
import { normalizar } from "@/lib/hunts/terms";
import { extrairCupons } from "@/lib/parse/coupon";
import { priceStats } from "@/lib/search/stats";
import { dispersaoDe, LIMITE_DISPERSAO } from "@/lib/search/trend";

/**
 * Resumo do dia: as ofertas que valem olhar, separadas por seção.
 *
 * ## A definição de "imperdível", e por que as óbvias não servem
 *
 * "Mais barato do dia" não diz nada — o mais barato é sempre um cabo de R$ 8.
 * "Maior desconto" é pior ainda: medido em 12/08 sobre as 24h reais, ranquear
 * por desconto trazia, no topo, um **monitor gamer a R$ 20** (erro de leitura
 * de preço) e uma penca de post de cupom. Os maiores descontos do arquivo são
 * sempre defeito do próprio sistema, nunca oferta.
 *
 * A única definição que se sustenta é **comparar o produto com ele mesmo**:
 * quanto este anúncio está abaixo da mediana desse mesmo produto nos últimos
 * `DIAS_HISTORICO` dias.
 *
 * ## Os quatro portões, todos medidos
 *
 * 1. **Histórico próprio** (`MIN_HISTORICO`): sem 3 anúncios anteriores do
 *    mesmo produto não há com o que comparar.
 * 2. **Dispersão** (`LIMITE_DISPERSAO`, reaproveitado de `trend.ts`): se os
 *    preços do grupo variam demais, a chave juntou produtos diferentes — é
 *    grupo-lixo, não produto. Sem este portão, uma linha de rodapé de canal
 *    virava chave e agrupava 325 anúncios sem relação.
 * 3. **Banda de desconto** (`DESCONTO_MIN` a `DESCONTO_MAX`): abaixo de 15% é
 *    variação normal de preço; acima de 60% é erro de parse. Oferta de verdade
 *    vive no meio.
 * 4. **Título não pode ser linha de cupom**: post cujo título é "20% OFF em
 *    compras acima de R$19" não é anúncio de produto.
 *
 * Resultado medido nas 24h de 12/08: de 1.072 posts com preço, sobram **9**.
 * É o tamanho certo de um resumo — o que não passa nos quatro portões não
 * merecia estar na lista.
 */

/** O "dia" do resumo. */
export const JANELA_HORAS = 24;
/**
 * Histórico usado como régua.
 *
 * Medido: 90 dias dão 11 achados, 30 dias dão 9 — 82% do resultado por um
 * terço das linhas lidas. A régua não precisa da janela inteira do arquivo.
 */
export const DIAS_HISTORICO = 30;
/** Anúncios anteriores do mesmo produto exigidos pra haver comparação. */
export const MIN_HISTORICO = 3;
/** Abaixo disto é variação normal; acima, erro de leitura de preço. */
export const DESCONTO_MIN = 0.15;
export const DESCONTO_MAX = 0.6;
/** Teto de linhas lidas por consulta, no mesmo espírito dos outros módulos. */
const TETO_LINHAS = 12000;

const STOP = new Set([
  "de",
  "da",
  "do",
  "com",
  "para",
  "por",
  "em",
  "e",
  "o",
  "a",
  "os",
  "as",
  "no",
  "na",
  "um",
  "uma",
  "pra",
]);

/** Título que na verdade é a regra de um cupom, não o nome de um produto. */
const TITULO_DE_CUPOM = /%\s*off|cupom|desconto|limite de|acima de/i;

export type Achado = {
  titulo: string;
  priceCents: number;
  /** Mediana do mesmo produto no histórico. */
  medianaCents: number;
  descontoPct: number;
  /** Quantos anúncios anteriores sustentam a mediana. */
  amostra: number;
  store: string | null;
  url: string;
  productUrl: string | null;
  kind: string;
};

export type ResumoDoDia = {
  /** Seções na ordem em que devem ser mostradas, já sem as vazias. */
  secoes: Array<{ kind: string; achados: Achado[] }>;
  /** Posts com preço examinados na janela. */
  examinados: number;
};

/**
 * Chave que identifica "o mesmo produto".
 *
 * Usa `tituloDoPost` de propósito, e não a primeira linha: a primeira versão
 * disto reimplementou a escolha de título de forma ingênua e agrupou
 * "Pasta Térmica" com "Budweiser", porque as duas caíam no mesmo rodapé de
 * canal. Os cinco primeiros tokens bastam pra separar modelo de modelo sem
 * quebrar por causa de cor ou capacidade no fim do nome.
 */
export function chaveDoProduto(texto: string): string | null {
  const tokens =
    normalizar(tituloDoPost(texto, 200))
      .match(/[a-z0-9]+/g)
      ?.filter((t) => !STOP.has(t) && !/^\d{1,2}$/.test(t)) ?? [];
  // Ordenados: "Smart TV Philips 4K 50PUG7300" e "Philips Smart TV 4K
  // 50PUG7300" são o mesmo aparelho, e a ordem das palavras no título é
  // escolha de quem escreveu o anúncio. Medido em 30 dias: +2% de posts
  // ganhando régua de histórico. Pouco, mas é de graça e não tem contra.
  return tokens.length >= 3 ? [...tokens.slice(0, 5)].sort().join(" ") : null;
}

/** Ordem das seções: onde o usuário mais compra primeiro. */
const ORDEM_KIND = ["tech", "china", "casa", "moda", "geral"];

export async function resumoDoDia(
  db: SupabaseClient,
  agora: Date = new Date(),
): Promise<ResumoDoDia> {
  const { data: canais, error: canalErr } = await db.from("channels").select("slug,kind");
  if (canalErr) throw new Error(`Lendo canais: ${canalErr.message}`);
  const kindPorSlug = new Map(
    (canais ?? []).map((c) => [c.slug as string, (c.kind as string) ?? "geral"]),
  );

  const desde = new Date(agora.getTime() - DIAS_HISTORICO * 24 * 3600 * 1000).toISOString();
  const { data, error } = await db
    .from("posts")
    .select("text,price_cents,posted_at,store,url,product_url,channel_slug")
    .not("price_cents", "is", null)
    .gte("posted_at", desde)
    .order("id", { ascending: false })
    .limit(TETO_LINHAS);
  if (error) throw new Error(`Lendo posts do resumo: ${error.message}`);

  const linhas = (data ?? []) as Array<{
    text: string;
    price_cents: number;
    posted_at: string;
    store: string | null;
    url: string;
    product_url: string | null;
    channel_slug: string;
  }>;

  const grupos = new Map<string, Array<{ price: number; postedAt: string }>>();
  for (const l of linhas) {
    const k = chaveDoProduto(l.text);
    if (!k) continue;
    grupos.set(k, [...(grupos.get(k) ?? []), { price: l.price_cents, postedAt: l.posted_at }]);
  }

  const corteDia = new Date(agora.getTime() - JANELA_HORAS * 3600 * 1000).toISOString();
  const doDia = linhas.filter((l) => l.posted_at >= corteDia);

  // Um achado por produto: o mesmo anúncio costuma sair em vários canais, e
  // repetir a mesma placa-mãe quatro vezes gastaria a lista inteira.
  const porProduto = new Map<string, Achado>();
  for (const l of doDia) {
    const titulo = tituloDoPost(l.text, 200);
    if (TITULO_DE_CUPOM.test(titulo)) continue;
    if (extrairCupons(titulo).length > 0) continue;

    const k = chaveDoProduto(l.text);
    if (!k) continue;

    const historico = (grupos.get(k) ?? [])
      .filter((x) => x.postedAt < l.posted_at)
      .map((x) => x.price);
    if (historico.length < MIN_HISTORICO) continue;

    const dispersao = dispersaoDe(historico);
    if (dispersao === null || dispersao > LIMITE_DISPERSAO) continue;

    const mediana = priceStats(historico)?.medianCents ?? 0;
    if (mediana <= 0) continue;

    const desconto = (mediana - l.price_cents) / mediana;
    if (desconto < DESCONTO_MIN || desconto > DESCONTO_MAX) continue;

    const anterior = porProduto.get(k);
    if (anterior && anterior.priceCents <= l.price_cents) continue;
    porProduto.set(k, {
      titulo: tituloDoPost(l.text, 62),
      priceCents: l.price_cents,
      medianaCents: mediana,
      descontoPct: Math.round(desconto * 100),
      amostra: historico.length,
      store: l.store,
      url: l.url,
      productUrl: l.product_url,
      kind: kindPorSlug.get(l.channel_slug) ?? "geral",
    });
  }

  // Segunda passada de dedup, por SOBREPOSIÇÃO de tokens.
  //
  // A chave de 5 tokens separa produto de produto, mas escorrega quando dois
  // canais anunciam o mesmo item com uma palavra a mais na frente: "Samsung
  // Galaxy A57 5G 128GB" e "Celular Samsung Galaxy A57 5G" geram chaves
  // diferentes e o A57 saía duas vezes no mesmo resumo, em seções diferentes.
  //
  // Interseção de 4 dos 5 tokens NÃO basta sozinha: "Placa Mãe MSI B550M A PRO
  // DDR4" e "Placa Mãe MSI B450M A PRO DDR4" compartilham 4 tokens e são
  // placas diferentes. Isso apareceu no primeiro teste da regra.
  //
  // O que separa modelo de modelo é sempre o token COM DÍGITO (b550m, a57,
  // 5g). Então o merge exige, além da interseção, que os tokens com dígito de
  // uma chave sejam subconjunto dos da outra:
  //
  //   {samsung galaxy a57 5g 128gb} vs {celular samsung galaxy a57 5g}
  //     dígitos: {a57,5g,128gb} ⊃ {a57,5g}  -> mesmo produto, funde
  //
  //   {placa mae msi b550m pro} vs {placa mae msi b450m pro}
  //     dígitos: {b550m} e {b450m}, nenhum contém o outro  -> não funde
  const MIN_SOBREPOSICAO = 4;
  const comDigito = (ts: Set<string>) => new Set([...ts].filter((t) => /\d/.test(t)));
  const contido = (a: Set<string>, b: Set<string>) => [...a].every((t) => b.has(t));
  const unicos: Array<[Set<string>, Achado]> = [];
  for (const [chave, achado] of porProduto) {
    const tokens = new Set(chave.split(" "));
    const meus = comDigito(tokens);
    const igual = unicos.find(([outros]) => {
      if ([...tokens].filter((t) => outros.has(t)).length < MIN_SOBREPOSICAO) return false;
      const deles = comDigito(outros);
      return contido(meus, deles) || contido(deles, meus);
    });
    if (!igual) {
      unicos.push([tokens, achado]);
      continue;
    }
    if (achado.priceCents < igual[1].priceCents) igual[1] = achado;
  }

  const porKind = new Map<string, Achado[]>();
  for (const [, a] of unicos) {
    porKind.set(a.kind, [...(porKind.get(a.kind) ?? []), a]);
  }

  const secoes = ORDEM_KIND.filter((k) => porKind.has(k)).map((kind) => ({
    kind,
    achados: (porKind.get(kind) ?? []).sort((a, b) => b.descontoPct - a.descontoPct),
  }));

  return { secoes, examinados: doDia.length };
}
