import { htmlToText } from "@/lib/parse/price";

const URL_RE = /https?:\/\/[^\s<>"')]+/g;

const BY_DOMAIN: Array<[RegExp, string]> = [
  [/(^|\.)amazon\.|(^|\.)amzn\.to$|link\.amazon/i, "amazon"],
  [/aliexpress/i, "aliexpress"],
  [/shopee/i, "shopee"],
  [/mercadoliv|mercadolib|(^|\.)meli\.la$|(^|\.)mlb\.la$/i, "mercadolivre"],
  [/magazineluiza|magazinevoce|magalu/i, "magalu"],
  [/kabum/i, "kabum"],
  [/casasbahia/i, "casasbahia"],
  [/(^|\.)samsung\./i, "samsung"],
];

const BY_TEXT: Array<[RegExp, string]> = [
  [/\bamazon\b/i, "amazon"],
  [/\bali\s?express\b/i, "aliexpress"],
  [/\bshopee\b/i, "shopee"],
  [/\bmercado\s?livre\b/i, "mercadolivre"],
  [/\bmagalu\b|\bmagazine\s?luiza\b/i, "magalu"],
  [/\bkabum\b/i, "kabum"],
  [/\bcasas\s?bahia\b/i, "casasbahia"],
  [/\bsamsung\b/i, "samsung"],
];

/**
 * Loja do post, em duas fontes: domínio do link primeiro, menção no texto depois.
 * O fallback textual existe porque canais como o CT Ofertas encurtam TUDO pelo
 * domínio próprio (canalte.ch) — só o domínio perderia o canal inteiro.
 */
export function detectStore(html: string): {
  store: string | null;
  productUrl: string | null;
} {
  const text = htmlToText(html);
  const urls = text.match(URL_RE) ?? [];
  const productUrl = urls[0] ?? null;

  for (const url of urls) {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    for (const [re, store] of BY_DOMAIN) {
      if (re.test(host)) return { store, productUrl };
    }
  }

  for (const [re, store] of BY_TEXT) {
    if (re.test(text)) return { store, productUrl };
  }

  return { store: null, productUrl };
}
