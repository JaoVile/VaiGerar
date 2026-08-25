import type { Metadata } from "next";
import { Vitrine } from "@/components/Vitrine";

export const metadata: Metadata = {
	title: "Caçador de Ofertas",
	description:
		"Coleta canais de promoção do Telegram, arquiva em Postgres e alerta só quando o produto entra na faixa de preço.",
};

export default function SobrePage() {
	return (
		<main className="wrap" style={{ paddingTop: 72, paddingBottom: 96 }}>
			<Vitrine />
		</main>
	);
}
