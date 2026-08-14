import { htmlToText, parsePrices } from "@/lib/parse/price";
import { detectStore } from "@/lib/parse/store";

export type ParsedPost = {
  postId: number;
  postedAt: string;
  text: string;
  url: string;
  priceCents: number | null;
  pricesCents: number[];
  store: string | null;
  productUrl: string | null;
  /**
   * Foto do anúncio, servida pelo CDN do Telegram. `null` quando o post é só
   * texto — medido em 100 posts de 5 canais, **98% têm foto**.
   */
  photoUrl: string | null;
};

const POST_ANCHOR_RE = /data-post="([^"/]+)\/(\d+)"/g;
const TEXT_RE = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/;
const TIME_RE = /<time[^>]*datetime="([^"]+)"/;
/**
 * A foto vem como `background-image` inline no wrapper, não como `<img src>`.
 *
 * A URL é do CDN do Telegram (`cdn*.telesco.pe`) e abre de fora sem
 * autenticação — verificado em 13/08: HTTP 200, `image/jpeg`, 88 KB. É ela que
 * o `sendPhoto` consome, então nada de imagem passa por este servidor.
 */
const PHOTO_RE =
  /tgme_widget_message_photo_wrap[^"]*"[^>]*style="[^"]*background-image:url\('([^']+)'\)/;

type PostAnchor = { index: number; postId: number };

/** Todas as ocorrências de `data-post` na página, na ordem em que aparecem. */
function postAnchors(html: string): PostAnchor[] {
  return [...html.matchAll(POST_ANCHOR_RE)].map((m) => ({
    index: m.index ?? 0,
    postId: Number(m[2]),
  }));
}

/**
 * Quantas âncoras `data-post` distintas a página tem. Puro.
 *
 * É o denominador que `parseChannelPage` descarta: página com âncoras mas zero
 * posts extraídos é parser quebrado (o t.me mudou o markup interno da mensagem),
 * não fim de arquivo. Quem chama usa a diferença pra decidir se pode avançar o
 * cursor do backfill — ver `decideBackfill`.
 */
export function countPostAnchors(html: string): number {
  return new Set(postAnchors(html).map((a) => a.postId)).size;
}

/**
 * HTML de t.me/s/<slug> → posts.
 *
 * A página não tem marcação aninhada confiável por mensagem, então fatiamos pelo
 * `data-post`, que é o único âncora estável: cada fatia vai de um âncora até o
 * próximo. Dentro da fatia, texto e horário saem por regex — o corpo da mensagem
 * só contém tags inline (a, b, i, br, s, code), nunca <div> aninhada.
 */
export function parseChannelPage(html: string, slug: string): ParsedPost[] {
  const anchors = postAnchors(html);

  const seen = new Set<number>();
  const posts: ParsedPost[] = [];

  for (let i = 0; i < anchors.length; i++) {
    const { index, postId } = anchors[i];
    if (seen.has(postId)) continue;

    const chunk = html.slice(index, anchors[i + 1]?.index ?? html.length);
    const textMatch = chunk.match(TEXT_RE);
    const timeMatch = chunk.match(TIME_RE);
    if (!textMatch || !timeMatch) continue;

    const rawHtml = textMatch[1];
    const text = htmlToText(rawHtml).trim();
    if (text.length === 0) continue;

    // `datetime` malformado faria `toISOString()` lançar RangeError e matar a
    // página inteira — um post ruim custaria os outros 19. Pula só ele.
    const postedAt = new Date(timeMatch[1]);
    if (Number.isNaN(postedAt.getTime())) continue;

    const { pricesCents, priceCents } = parsePrices(rawHtml);
    const { store, productUrl } = detectStore(rawHtml);
    // Do `chunk` e não do `rawHtml`: a foto vive fora da div de texto.
    const photoMatch = chunk.match(PHOTO_RE);

    seen.add(postId);
    posts.push({
      postId,
      postedAt: postedAt.toISOString(),
      text,
      url: `https://t.me/${slug}/${postId}`,
      priceCents,
      pricesCents,
      store,
      productUrl,
      photoUrl: photoMatch ? photoMatch[1] : null,
    });
  }

  return posts.sort((a, b) => a.postId - b.postId);
}
