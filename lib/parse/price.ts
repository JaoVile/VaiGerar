const STRIKE_RE = /<(s|del|strike)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BR_RE = /<br\s*\/?>/gi;
const TAG_RE = /<[^>]+>/g;
const PRICE_RE = /R\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)/gi;
const INSTALLMENT_RE = /\d{1,2}\s*x\s*(?:de\s*)?$/i;

/** Piso: abaixo de R$1,00 é cupom/frete/centavo solto, não preço de produto. */
const MIN_PRICE_CENTS = 100;

/**
 * Teto: R$5.000.000,00. Canal de oferta anuncia celular, eletrônico e importado —
 * nada acima de alguns milhões de reais é oferta de verdade; acima disso é ruído
 * (número de telefone/CEP colado no cifrão, valor de sorteio, "carro por R$
 * 25.000.000"). O teto também protege a coluna `price_cents`, que é `integer` no
 * Postgres: `int4` vai até 2.147.483.647 (R$21.474.836,47), e um único valor acima
 * disso derruba o `upsert` do lote inteiro — no backfill isso é permanente, porque
 * a mesma página é rebuscada a cada invocação e o cursor nunca avança. R$5M deixa
 * margem larga abaixo do overflow e ainda assim descarta só o que é ruído.
 */
const MAX_PRICE_CENTS = 500_000_000;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Code point válido pra `String.fromCodePoint` sem lançar RangeError. */
function isValidCodePoint(codePoint: number): boolean {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff;
}

/** HTML do post → texto puro, descartando o que estiver riscado (preço velho). */
export function htmlToText(html: string): string {
  const withoutStrike = html.replace(STRIKE_RE, " ");
  const withBreaks = withoutStrike.replace(BR_RE, "\n");
  const stripped = withBreaks.replace(TAG_RE, "");
  // Telegram escapa caracteres como "$" em referências numéricas (ex.: "R&#036;"
  // vira "R$"), não só nas entidades nomeadas — decodifica as duas formas, antes
  // das nomeadas (senão "&amp;#036;" viraria "$" em vez de "&#036;" literal).
  // Code point inválido/malformado (ex.: &#99999999;) devolve a sequência
  // original em vez de lançar — um post excêntrico não pode derrubar o canal.
  const withNumericEntities = stripped
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&#(\d+);/g, (match, dec: string) => {
      const codePoint = Number.parseInt(dec, 10);
      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : match;
    });
  return withNumericEntities.replace(
    /&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g,
    (m) => ENTITIES[m] ?? m,
  );
}

/** "3.149,10" → 314910. Ponto é milhar, vírgula é decimal (formato BR). */
export function toCents(raw: string): number | null {
  const hasComma = raw.includes(",");
  const normalized = hasComma ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/\./g, "");
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/**
 * Extrai todos os preços válidos do post.
 * Descarta parcela ("12x de R$ 274,91"), preço riscado e o que cai fora da
 * faixa plausível [MIN_PRICE_CENTS, MAX_PRICE_CENTS].
 * `priceCents` é o menor — o preço Pix, que é o que vale.
 */
export function parsePrices(html: string): {
  pricesCents: number[];
  priceCents: number | null;
} {
  const text = htmlToText(html);
  const found: number[] = [];

  for (const match of text.matchAll(PRICE_RE)) {
    const at = match.index ?? 0;
    const before = text.slice(Math.max(0, at - 12), at);
    if (INSTALLMENT_RE.test(before)) continue;

    const cents = toCents(match[1]);
    if (cents === null) continue;
    if (cents < MIN_PRICE_CENTS || cents > MAX_PRICE_CENTS) continue;
    found.push(cents);
  }

  const pricesCents = [...new Set(found)].sort((a, b) => a - b);
  return { pricesCents, priceCents: pricesCents[0] ?? null };
}
