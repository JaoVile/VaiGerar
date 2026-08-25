import { Vitrine } from "@/components/Vitrine";

export const dynamic = "force-dynamic";

/**
 * Quem chega sem sessão cai aqui vindo do middleware. Antes essa rota era só
 * um campo de senha no escuro: quem não tinha a senha não fazia ideia do que
 * era o projeto, e quem tinha não precisava de explicação nenhuma.
 *
 * Agora a página apresenta o sistema e o acesso ao painel fica onde deve —
 * no fim, como detalhe operacional.
 */
export default async function Login({
	searchParams,
}: {
	searchParams: Promise<{ erro?: string }>;
}) {
	const { erro } = await searchParams;

	return (
		<Vitrine>
			<form method="post" action="/api/login" className="vit-acesso">
				<label htmlFor="senha" className="vit-acesso-tag">
					Painel de rodadas
				</label>
				<p className="vit-acesso-nota">
					O log de coleta é privado. O resto desta página não.
				</p>
				<div className="vit-acesso-linha">
					<input
						id="senha"
						type="password"
						name="senha"
						placeholder="senha"
						autoComplete="current-password"
						required
					/>
					<button type="submit">Entrar</button>
				</div>
				{erro && <p className="vit-acesso-erro">Senha incorreta.</p>}
			</form>
		</Vitrine>
	);
}
