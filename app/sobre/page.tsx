import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Caçador de Ofertas",
	description:
		"Coleta canais de promoção do Telegram, arquiva em Postgres e alerta só quando o produto entra na faixa de preço.",
};

const FEATURES = [
	{
		label: "Coleta",
		text: "Um coletor em cron raspa as páginas públicas dos canais a cada cinco minutos e extrai preço, cupom e loja de texto livre em português.",
	},
	{
		label: "Caçada",
		text: "Você descreve o que procura pro bot de Telegram; um job separado casa os posts novos contra a sua faixa de preço e só então alerta.",
	},
	{
		label: "Sinal, não ruído",
		text: "Cupom não é confundido com preço, e um piso de sanidade calibrado com três meses de dado real filtra capinha sendo lida como celular.",
	},
	{
		label: "Canário",
		text: "Se todo canal devolve zero post no mesmo tick, o painel acusa — isso não é dia parado, é o coletor quebrado.",
	},
];

const METRICS = [
	{ value: "476", label: "Testes passando" },
	{ value: "103", label: "Commits" },
	{ value: "9", label: "Migrações SQL" },
	{ value: "25", label: "Canais ativos" },
];

export default function SobrePage() {
	return (
		<main className="wrap" style={{ paddingTop: 72, paddingBottom: 96 }}>
			<p className="label" style={{ marginBottom: 16 }}>
				// Caçador de Ofertas
			</p>
			<h1
				style={{
					fontSize: "clamp(32px, 6vw, 56px)",
					lineHeight: 1.05,
					fontWeight: 600,
					maxWidth: 780,
					marginBottom: 20,
				}}
			>
				Lê canais de promoção do Telegram e só te acorda quando o preço tá
				certo.
			</h1>
			<p
				style={{
					maxWidth: 560,
					color: "var(--mute)",
					marginBottom: 48,
					fontSize: 16,
				}}
			>
				Canais de oferta publicam milhares de itens por dia. Todo bot de alerta
				pronto dispara pelo nome do produto — dispara sempre, e você para de
				ler. Este não.
			</p>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
					gap: 1,
					background: "var(--rule)",
					border: "1px solid var(--rule)",
					marginBottom: 56,
				}}
			>
				{METRICS.map((m) => (
					<div
						key={m.label}
						style={{ background: "var(--panel)", padding: "20px 18px" }}
					>
						<div
							className="mono"
							style={{ fontSize: 28, color: "var(--signal)", marginBottom: 6 }}
						>
							{m.value}
						</div>
						<div className="label">{m.label}</div>
					</div>
				))}
			</div>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
					gap: 24,
					marginBottom: 56,
				}}
			>
				{FEATURES.map((f) => (
					<div key={f.label}>
						<p
							className="label"
							style={{ marginBottom: 8, color: "var(--signal)" }}
						>
							{f.label}
						</p>
						<p style={{ color: "var(--bone)", fontSize: 14, lineHeight: 1.6 }}>
							{f.text}
						</p>
					</div>
				))}
			</div>

			<div
				style={{
					borderTop: "1px solid var(--rule)",
					paddingTop: 24,
					display: "flex",
					gap: 24,
					alignItems: "center",
					flexWrap: "wrap",
				}}
			>
				<span className="label">Next.js · Supabase · Telegram Bot</span>
				<a
					href="https://github.com/JaoVile/VaiGerar"
					target="_blank"
					rel="noopener noreferrer"
					className="mono"
					style={{
						fontSize: 12,
						textTransform: "uppercase",
						letterSpacing: "0.1em",
					}}
				>
					código no GitHub →
				</a>
				<a
					href="/"
					className="mono"
					style={{
						fontSize: 12,
						textTransform: "uppercase",
						letterSpacing: "0.1em",
						color: "var(--mute)",
					}}
				>
					painel (protegido) →
				</a>
			</div>
		</main>
	);
}
