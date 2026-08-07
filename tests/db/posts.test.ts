import { describe, expect, it } from "vitest";
import type { ParsedPost } from "@/lib/collector/parse";
import { selectNewPosts, toPostRows } from "@/lib/db/posts";

const post = (postId: number, over: Partial<ParsedPost> = {}): ParsedPost => ({
	postId,
	postedAt: "2026-08-03T19:18:15.000Z",
	text: "Galaxy S25+ por R$ 3.099,00",
	url: `https://t.me/canal/${postId}`,
	priceCents: 309900,
	pricesCents: [309900],
	store: "amazon",
	productUrl: "https://link.amazon/x",
	...over,
});

describe("selectNewPosts", () => {
	it("mantém só o que passou do cursor", () => {
		const r = selectNewPosts([post(10), post(11), post(12)], 11);
		expect(r.map((p) => p.postId)).toEqual([12]);
	});
	it("devolve tudo quando o cursor é zero", () => {
		expect(selectNewPosts([post(1), post(2)], 0)).toHaveLength(2);
	});
	it("devolve vazio quando nada é novo", () => {
		expect(selectNewPosts([post(1), post(2)], 99)).toEqual([]);
	});
});

describe("toPostRows", () => {
	it("mapeia para as colunas da tabela", () => {
		const [row] = toPostRows([post(7)], "gtOFERTAS");
		expect(row).toEqual({
			channel_slug: "gtOFERTAS",
			post_id: 7,
			posted_at: "2026-08-03T19:18:15.000Z",
			text: "Galaxy S25+ por R$ 3.099,00",
			url: "https://t.me/canal/7",
			price_cents: 309900,
			prices_cents: [309900],
			store: "amazon",
			product_url: "https://link.amazon/x",
		});
	});

	it("preserva null de preço e loja", () => {
		const [row] = toPostRows(
			[
				post(8, {
					priceCents: null,
					pricesCents: [],
					store: null,
					productUrl: null,
				}),
			],
			"x",
		);
		expect(row.price_cents).toBeNull();
		expect(row.prices_cents).toEqual([]);
		expect(row.store).toBeNull();
	});
});
