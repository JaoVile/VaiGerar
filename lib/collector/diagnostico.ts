import { type ParsedPost, parseChannelPage } from "@/lib/collector/parse";

/**
 * O que a interface mostra ANTES de cadastrar um canal.
 *
 * Existe por causa da 0006: dos 24 candidatos testados à mão naquela
 * expansão, 6 estavam mortos apesar de listados como ativos e 5 eram canais
 * de cupom. Aquele trabalho foi manual e levou uma tarde; cadastrar canal
 * pela interface sem repetir a checagem seria trocá-la por uma linha que
 * falha em silêncio.
 *
 * O preview roda o **parser real do projeto**, não uma inspeção própria: o
 * número que a tela mostra é o mesmo que o tick vai gravar.
 *
 * ## O que mudou desde a 0006
 *
 * Lá, canal de cupom era veneno — "R$15 de desconto em R$75" virava R$ 15,00
 * e contaminava a mediana (2.225 posts corrompidos em 10/08). Hoje
 * `lib/parse/price.ts` descarta valor de desconto de propósito, então o
 * mesmo canal não corrompe mais nada: ele simplesmente entra e **nunca
 * devolve preço**. O sintoma virou o oposto — silêncio em vez de sujeira —,
 * e é por isso que o veredito olha a TAXA DE POSTS COM PREÇO, não a forma da
 * frase. O cheiro de cupom continua medido, mas como explicação do silêncio,
 * não como causa da rejeição.
 */

/** Marca da página de canal público com preview aberto. Ausente = não dá pra ler. */
const MARCA_CANAL = "tgme_channel_info";
const OG_TITLE_RE = /<meta property="og:title" content="([^"]*)"/;
const SUBS_RE =
  /<span class="counter_value">([^<]+)<\/span> <span class="counter_type">subscribers/;

/**
 * A frase de canal de cupom. O que separa "post com cupom" (29% do arquivo,
 * normal) de "canal de cupom" (veneno) é o desconto vir escrito COMO preço —
 * as três formas abaixo cobrem os 5 canais rejeitados na 0006.
 */
const RE_CUPOM_COMO_PRECO = /\bde desconto\b|\bdesconto em\b|\blimite de\s*r\$/i;

export type MotivoIndisponivel = "sem-preview" | "sem-posts";

export type Diagnostico = {
  slug: string;
  /** `null` quando a página não é de canal legível. */
  titulo: string | null;
  inscritos: string | null;
  /** `null` quando dá pra ler. */
  indisponivel: MotivoIndisponivel | null;
  postsNaPagina: number;
  /** Estimado pelo intervalo entre o post mais novo e o mais velho da página. */
  postsPorDia: number;
  comPreco: number;
  precoMedianaCents: number | null;
  /** Fração dos posts cuja frase é de desconto, não de preço de produto. */
  cheiroDeCupom: number;
  amostra: Array<{ texto: string; precoCents: number | null }>;
};

/** Mediana, não média: um preço mal lido de R$ 4,14 puxa a média e não move a mediana. */
export function medianaCents(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[meio] : Math.round((v[meio - 1] + v[meio]) / 2);
}

/**
 * Ritmo do canal a partir de uma página só.
 *
 * A página do `t.me/s/` traz ~20 posts. Num canal de 400 posts/dia isso é uma
 * hora de conteúdo, e extrapolar uma hora pra um dia erra — mas erra pra
 * cima, que é o lado seguro: o número serve pra decidir se cabe no disco.
 */
export function estimarPostsPorDia(posts: ParsedPost[]): number {
  if (posts.length < 2) return posts.length;
  const t = posts.map((p) => new Date(p.postedAt).getTime()).sort((a, b) => a - b);
  const dias = (t[t.length - 1] - t[0]) / 86_400_000;
  // Janela menor que 5 min é ruído de relógio, não ritmo.
  if (dias <= 0.0035) return posts.length;
  return (posts.length - 1) / dias;
}

export function diagnosticar(html: string, slug: string): Diagnostico {
  const vazio = {
    slug,
    inscritos: null,
    postsNaPagina: 0,
    postsPorDia: 0,
    comPreco: 0,
    precoMedianaCents: null,
    cheiroDeCupom: 0,
    amostra: [],
  };

  // Slug que não existe, canal privado e grupo redirecionam pro cartão de
  // contato — HTTP 200, sem preview. Sem esta checagem o cadastro aceitaria
  // qualquer string e o canal entraria pra sempre com zero post.
  if (!html.includes(MARCA_CANAL)) {
    return { ...vazio, titulo: null, indisponivel: "sem-preview" };
  }

  const titulo = OG_TITLE_RE.exec(html)?.[1]?.trim() ?? null;
  const inscritos = SUBS_RE.exec(html)?.[1] ?? null;
  const posts = parseChannelPage(html, slug);

  // Âncora existe mas o parser não devolveu nada: é o mesmo sinal do canário
  // do tick (mudança no HTML do t.me), não um canal ruim.
  if (posts.length === 0) {
    return { ...vazio, titulo, inscritos, indisponivel: "sem-posts" };
  }

  const comPreco = posts.filter((p) => p.priceCents !== null);
  const cupom = posts.filter((p) => RE_CUPOM_COMO_PRECO.test(p.text));

  return {
    slug,
    titulo,
    inscritos,
    indisponivel: null,
    postsNaPagina: posts.length,
    postsPorDia: estimarPostsPorDia(posts),
    comPreco: comPreco.length,
    precoMedianaCents: medianaCents(comPreco.map((p) => p.priceCents as number)),
    cheiroDeCupom: cupom.length / posts.length,
    amostra: posts.slice(0, 6).map((p) => ({
      texto: p.text.slice(0, 160),
      precoCents: p.priceCents,
    })),
  };
}

/** Acima disto o canal fala em desconto, não em preço de produto. */
export const LIMIAR_CUPOM = 0.4;

/** Abaixo desta taxa de posts com preço o canal não rende alerta nenhum. */
export const TAXA_MINIMA_PRECO = 0.15;
/** Entre este valor e o mínimo o canal entra, mas rendendo pouco. */
export const TAXA_BOA_PRECO = 0.3;

export type Veredito = { pode: boolean; tom: "ok" | "warn" | "crit"; texto: string };

export function veredito(d: Diagnostico): Veredito {
  if (d.indisponivel === "sem-preview") {
    return {
      pode: false,
      tom: "crit",
      texto:
        "Sem preview público. O coletor lê t.me/s/<slug> sem login — canal privado, grupo ou slug errado não dá pra ler.",
    };
  }
  if (d.indisponivel === "sem-posts") {
    return {
      pode: false,
      tom: "crit",
      texto: "A página abre mas o parser não achou post. Canal vazio ou mudança no HTML do t.me.",
    };
  }
  const taxa = d.comPreco / d.postsNaPagina;
  const ehCupom = d.cheiroDeCupom >= LIMIAR_CUPOM;

  if (taxa < TAXA_MINIMA_PRECO) {
    return {
      pode: false,
      tom: "crit",
      texto: ehCupom
        ? `Canal de cupom: ${Math.round(d.cheiroDeCupom * 100)}% dos posts anunciam desconto, não preço. O parser descarta valor de cupom de propósito (senão ele viraria preço do produto, como em 10/08), então este canal entraria e nunca casaria uma caça.`
        : `Só ${d.comPreco} de ${d.postsNaPagina} posts têm preço legível. O canal ocuparia disco sem render alerta.`,
    };
  }
  if (taxa < TAXA_BOA_PRECO) {
    return {
      pode: true,
      tom: "warn",
      texto: `Só ${d.comPreco} de ${d.postsNaPagina} posts têm preço legível. Entra, mas rende pouco alerta.`,
    };
  }
  return {
    pode: true,
    tom: "ok",
    texto: `${d.comPreco} de ${d.postsNaPagina} posts com preço legível.`,
  };
}

/**
 * Aceita o que dá pra copiar do Telegram e devolve só o slug.
 *
 * Quem cadastra canal está com o app aberto, e o que o app oferece é
 * `https://t.me/pechinchou` ou `@pechinchou` — exigir o slug puro seria
 * transformar um "colar" em "colar e editar", com um erro de digitação de
 * brinde. `null` quando não sobra um username válido do Telegram (5 a 32
 * caracteres, letra/número/underscore).
 */
export function normalizarSlug(entrada: string): string | null {
  let s = entrada.trim();
  s = s.replace(/^https?:\/\//i, "").replace(/^(www\.)?t(elegram)?\.me\//i, "");
  s = s.replace(/^s\//i, "").replace(/^@/, "");
  s = s.split(/[/?#]/)[0].trim();
  return /^[A-Za-z0-9_]{5,32}$/.test(s) ? s : null;
}

/** As categorias que `channels_kind_check` (0003) aceita. */
export const KINDS = ["tech", "china", "moda", "casa", "geral"] as const;
export type Kind = (typeof KINDS)[number];

export function ehKind(v: unknown): v is Kind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}
