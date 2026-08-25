import type { Metadata } from "next";
import { Vitrine } from "@/components/Vitrine";

export const metadata: Metadata = {
	title: "Caçador de Ofertas",
	description:
		"Vinte e cinco canais de promoção do Telegram varridos a cada cinco minutos. Alerta só quando o preço entra na sua faixa.",
};

export default function SobrePage() {
	return <Vitrine />;
}
