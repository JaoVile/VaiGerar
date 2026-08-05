const STRIKE_RE = /<(s|del|strike)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BR_RE = /<br\s*\/?>/gi;
const TAG_RE = /<[^>]+>/g;
const PRICE_RE = /R\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)/gi;
const INSTALLMENT_RE = /\d{1,2}\s*x\s*(?:de\s*)?$/i;

const ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
	"&nbsp;": " ",
};

/** HTML do post → texto puro, descartando o que estiver riscado (preço velho). */
export function htmlToText(html: string): string {
	const withoutStrike = html.replace(STRIKE_RE, " ");
	const withBreaks = withoutStrike.replace(BR_RE, "\n");
	const stripped = withBreaks.replace(TAG_RE, "");
	// Telegram escapa caracteres como "$" em referências numéricas (ex.: "R&#036;"
	// vira "R$"), não só nas entidades nomeadas — decodifica as duas formas.
	const withNumericEntities = stripped
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/&#(\d+);/g, (_, dec: string) =>
			String.fromCodePoint(Number.parseInt(dec, 10)),
		);
	return withNumericEntities.replace(
		/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g,
		(m) => ENTITIES[m] ?? m,
	);
}

/** "3.149,10" → 314910. Ponto é milhar, vírgula é decimal (formato BR). */
export function toCents(raw: string): number | null {
	const hasComma = raw.includes(",");
	const normalized = hasComma
		? raw.replace(/\./g, "").replace(",", ".")
		: raw.replace(/\./g, "");
	const value = Number(normalized);
	if (!Number.isFinite(value)) return null;
	return Math.round(value * 100);
}

/**
 * Extrai todos os preços válidos do post.
 * Descarta parcela ("12x de R$ 274,91") e preço riscado.
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
		if (cents !== null && cents >= 100) found.push(cents);
	}

	const pricesCents = [...new Set(found)].sort((a, b) => a - b);
	return { pricesCents, priceCents: pricesCents[0] ?? null };
}
