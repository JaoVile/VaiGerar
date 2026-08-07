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
};

const POST_ANCHOR_RE = /data-post="([^"/]+)\/(\d+)"/g;
const TEXT_RE = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/;
const TIME_RE = /<time[^>]*datetime="([^"]+)"/;

/**
 * HTML de t.me/s/<slug> → posts.
 *
 * A página não tem marcação aninhada confiável por mensagem, então fatiamos pelo
 * `data-post`, que é o único âncora estável: cada fatia vai de um âncora até o
 * próximo. Dentro da fatia, texto e horário saem por regex — o corpo da mensagem
 * só contém tags inline (a, b, i, br, s, code), nunca <div> aninhada.
 */
export function parseChannelPage(html: string, slug: string): ParsedPost[] {
  const anchors = [...html.matchAll(POST_ANCHOR_RE)].map((m) => ({
    index: m.index ?? 0,
    postId: Number(m[2]),
  }));

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

    const { pricesCents, priceCents } = parsePrices(rawHtml);
    const { store, productUrl } = detectStore(rawHtml);

    seen.add(postId);
    posts.push({
      postId,
      postedAt: new Date(timeMatch[1]).toISOString(),
      text,
      url: `https://t.me/${slug}/${postId}`,
      priceCents,
      pricesCents,
      store,
      productUrl,
    });
  }

  return posts.sort((a, b) => a.postId - b.postId);
}
