import { Vitrine } from "@/components/Vitrine";

export const dynamic = "force-dynamic";

/**
 * Quem chega sem sessão cai aqui vindo do middleware. Antes essa rota era só
 * um campo de senha no meio do escuro: quem não tinha a senha não fazia ideia
 * do que era o projeto, e quem tinha não precisava de explicação nenhuma.
 * Agora a página apresenta o sistema e deixa o acesso ao painel como detalhe.
 */
export default async function Login({
	searchParams,
}: {
	searchParams: Promise<{ erro?: string }>;
}) {
	const { erro } = await searchParams;

	return (
		<main className="wrap" style={{ paddingTop: 64, paddingBottom: 88 }}>
			<Vitrine>
				<form
					method="post"
					action="/api/login"
					style={{
						background: "var(--panel)",
						border: "1px solid var(--rule)",
						padding: "20px 22px",
						maxWidth: 360,
						marginBottom: 48,
					}}
				>
					<div className="label" style={{ marginBottom: 4 }}>
						Painel de rodadas
					</div>
					<p style={{ color: "var(--mute)", fontSize: 13, marginBottom: 12 }}>
						O log de coleta é privado — o resto desta página não.
					</p>
					<input
						type="password"
						name="senha"
						placeholder="senha"
						autoComplete="current-password"
						required
						style={{
							width: "100%",
							fontFamily: "var(--mono)",
							fontSize: 14,
							background: "var(--ink-deep)",
							color: "var(--bone)",
							border: "1px solid var(--rule)",
							padding: "10px 12px",
							marginBottom: 12,
						}}
					/>
					{erro && (
						<p className="err" style={{ marginBottom: 12 }}>
							Senha incorreta.
						</p>
					)}
					<button type="submit" className="btn" style={{ width: "100%" }}>
						Entrar
					</button>
				</form>
			</Vitrine>
		</main>
	);
}
