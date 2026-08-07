import { describe, expect, it } from "vitest";
import type { ParsedPost } from "@/lib/collector/parse";
import { decideBackfill } from "@/lib/cron/backfill";

const LIMITE = new Date("2026-02-05T00:00:00Z");

const post = (postId: number, postedAt: string): ParsedPost => ({
	postId,
	postedAt,
	text: "t",
	url: "u",
	priceCents: null,
	pricesCents: [],
	store: null,
	productUrl: null,
});

describe("decideBackfill", () => {
	it("encerra quando a página vem vazia", () => {
		const d = decideBackfill([], LIMITE);
		expect(d.done).toBe(true);
		expect(d.reason).toMatch(/vazia/i);
	});

	it("encerra quando os posts passaram da janela", () => {
		const d = decideBackfill([post(5, "2025-11-01T00:00:00Z")], LIMITE);
		expect(d.done).toBe(true);
		expect(d.reason).toMatch(/janela/i);
	});

	it("continua e aponta o cursor para o menor postId", () => {
		const d = decideBackfill(
			[post(30, "2026-03-01T00:00:00Z"), post(28, "2026-03-01T00:00:00Z")],
			LIMITE,
		);
		expect(d.done).toBe(false);
		expect(d.nextCursor).toBe(28);
	});

	it("encerra com cursor travado quando o cursor não avança", () => {
		const d = decideBackfill(
			[post(30, "2026-03-01T00:00:00Z"), post(28, "2026-03-01T00:00:00Z")],
			LIMITE,
			28,
		);
		expect(d.done).toBe(true);
		expect(d.reason).toMatch(/cursor.*travado/i);
	});
});
