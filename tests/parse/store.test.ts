import { describe, expect, it } from "vitest";
import { detectStore } from "@/lib/parse/store";

describe("detectStore", () => {
	it("reconhece pelo domínio do encurtador da Amazon", () => {
		const r = detectStore("Oferta boa https://link.amazon/abc123 corre");
		expect(r.store).toBe("amazon");
		expect(r.productUrl).toBe("https://link.amazon/abc123");
	});

	it("reconhece shopee e aliexpress pelo domínio", () => {
		expect(detectStore("https://s.shopee.com.br/x").store).toBe("shopee");
		expect(detectStore("https://s.click.aliexpress.com/e/y").store).toBe(
			"aliexpress",
		);
	});

	it("reconhece mercado livre pelo encurtador meli.la", () => {
		expect(detectStore("https://meli.la/abc").store).toBe("mercadolivre");
	});

	it("cai no texto quando o domínio é encurtador do próprio canal", () => {
		const r = detectStore(
			"Cupom no Magalu! Acesse: https://canalte.ch/c2p4/pbkbi",
		);
		expect(r.store).toBe("magalu");
		expect(r.productUrl).toBe("https://canalte.ch/c2p4/pbkbi");
	});

	it("prefere o domínio sobre a menção no texto", () => {
		const r = detectStore("Igual ao da Shopee! https://link.amazon/abc");
		expect(r.store).toBe("amazon");
	});

	it("devolve null quando nada resolve", () => {
		const r = detectStore("Promoção imperdível https://canalte.ch/xyz");
		expect(r.store).toBeNull();
		expect(r.productUrl).toBe("https://canalte.ch/xyz");
	});

	it("devolve productUrl null quando não há link", () => {
		expect(detectStore("sem link aqui").productUrl).toBeNull();
	});
});
