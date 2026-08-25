import { Archivo, JetBrains_Mono } from "next/font/google";

/**
 * A parte pública do projeto.
 *
 * A tese é ruído contra sinal: o coletor lê milhares de posts histéricos por
 * dia e quase nunca fala. Então a página não *descreve* isso, ela mostra —
 * a parede de promoção rola atrás, ilegível, e um único alerta fica parado
 * na frente. Quem chega entende o produto antes de ler uma linha sobre ele.
 *
 * Vive num componente porque duas rotas mostram o mesmo conteúdo: `/sobre`
 * pra quem chega por link e `/login` pra quem cai no painel sem sessão.
 */

// Sem `weight` de propósito: o eixo de largura só existe na fonte variável, e
// o `wdth` é justamente o que dá ao título o peso de placa de preço.
const display = Archivo({
	subsets: ["latin"],
	axes: ["wdth"],
	variable: "--vit-display",
});

const mono = JetBrains_Mono({
	subsets: ["latin"],
	variable: "--vit-mono",
});

/**
 * O vernáculo real dos canais: caixa alta, emoji, urgência inventada. É o
 * material bruto que o parser encara — por isso aparece como é, e não como
 * um lorem ipsum educado.
 */
const RUIDO = [
	"🔥 MENOR PREÇO! Fone JBL Tune 510BT R$ 89,90 CORRE",
	"CUPOM R$30 OFF em qualquer produto",
	"ÚLTIMAS UNIDADES!!! Air Fryer 4L R$ 199",
	'⚡ RELÂMPAGO Smart TV 50" R$ 1.799 SÓ HOJE',
	"PREÇO ERRADO?? Notebook R$ 2.099 🔥🔥🔥",
	"FRETE GRÁTIS + 20% OFF acima de R$ 300",
	"IMPERDÍVEL 😱 Capinha iPhone R$ 12,90",
	"BAIXOU DE NOVO! Cafeteira R$ 149",
	"R$ 50 OFF no primeiro pedido",
	"ACABANDO ⏰ Teclado mecânico R$ 219",
	"PROMOÇÃO RELÂMPAGO 🚨 SSD 1TB R$ 329",
	"SÓ ATÉ MEIA-NOITE!! Mouse gamer R$ 79,90",
	"CUPOM: LEVA10 — 10% em tudo",
	"OLHA O PREÇO 👀 Robô aspirador R$ 899",
	"VOLTOU! Caixa de som R$ 119 🔥",
	"DESCONTO PROGRESSIVO ATÉ 40% OFF",
];

/** Três trilhas com velocidades diferentes: a parede não pulsa em bloco. */
const TRILHAS = [
	{ itens: [...RUIDO.slice(0), ...RUIDO.slice(0)], dur: "48s" },
	{
		itens: [...RUIDO.slice(5), ...RUIDO.slice(0, 5), ...RUIDO.slice(5)],
		dur: "63s",
	},
	{
		itens: [...RUIDO.slice(9), ...RUIDO.slice(0, 9), ...RUIDO.slice(9)],
		dur: "55s",
	},
];

const RECUSAS = [
	{
		titulo: "Cupom não é preço",
		texto:
			"“R$30 OFF” lido como produto de R$ 30 derruba a mediana e faz toda caçada parecer satisfeita. Separar as duas coisas foi o conserto que tornou o alerta confiável.",
	},
	{
		titulo: "Capinha não é celular",
		texto:
			"O piso de sanidade foi calibrado contra três meses de posts coletados, com taxa de falso positivo documentada por limiar. Decisão embasada numa tabela, não em chute.",
	},
	{
		titulo: "Silêncio é suspeito",
		texto:
			"Se todo canal devolve zero post no mesmo tick, isso não é dia parado — é o coletor quebrado. O canário pega a falha silenciosa que monitoramento costuma deixar passar.",
	},
];

export function Vitrine({ children }: { children?: React.ReactNode }) {
	return (
		<div className={`vit ${display.variable} ${mono.variable}`}>
			{/* HERO — a parede rola, o alerta não */}
			<section className="vit-hero">
				<div className="vit-parede" aria-hidden="true">
					{TRILHAS.map((t, i) => (
						<div key={t.dur} className="vit-trilha" data-col={i}>
							<div className="vit-fluxo" style={{ animationDuration: t.dur }}>
								{t.itens.map((texto, j) => (
									<p key={`${texto}-${j}`} className="vit-post">
										{texto}
									</p>
								))}
							</div>
						</div>
					))}
				</div>

				<div className="vit-hero-frente">
					<p className="vit-eyebrow">Caçador de Ofertas</p>
					<h1 className="vit-titulo">
						Lê tudo.
						<br />
						<em>Fala pouco.</em>
					</h1>

					<div className="vit-alerta" role="status">
						<p className="vit-alerta-topo">
							<span className="vit-ponto" />
							Alerta
						</p>
						<p className="vit-alerta-produto">Monitor LG 27&quot; 144Hz</p>
						<p className="vit-alerta-preco">R$ 1.199,00</p>
						<p className="vit-alerta-nota">
							entrou na sua faixa — teto R$ 1.400
						</p>
					</div>

					<p className="vit-lede">
						Vinte e cinco canais de promoção, varridos a cada cinco minutos.
						Quase tudo que passa por aqui morre no arquivo. Você só é
						interrompido quando o preço que você pediu realmente aconteceu.
					</p>
				</div>
			</section>

			{/* AUTÓPSIA — a decisão técnica que separa este bot dos prontos */}
			<section className="vit-sec">
				<h2 className="vit-sec-titulo">O post que quebrava tudo</h2>
				<p className="vit-sec-lede">
					Bot de alerta pronto dispara pelo nome do produto. Esse é o motivo de
					ele disparar sempre — e de você parar de ler. O problema aparece
					inteiro num post de uma linha:
				</p>

				<p className="vit-cru">CUPOM R$30 OFF em qualquer produto</p>

				<div className="vit-leituras">
					<div className="vit-leitura vit-errada">
						<p className="vit-leitura-tag">Leitura ingênua</p>
						<p className="vit-leitura-saida">
							produto: <b>R$ 30,00</b>
						</p>
						<p className="vit-leitura-nota">
							Vira a oferta mais barata do dia, puxa a mediana pra baixo e
							satisfaz qualquer caçada aberta. O alerta chega, e está errado.
						</p>
					</div>
					<div className="vit-leitura vit-certa">
						<p className="vit-leitura-tag">Leitura do caçador</p>
						<p className="vit-leitura-saida">
							cupom: <b>R$ 30 de desconto</b>
							<br />
							produto: <b>sem preço</b>
						</p>
						<p className="vit-leitura-nota">
							Não há produto, então não há oferta. O post é arquivado e ninguém
							é acordado. Silêncio aqui é a resposta certa.
						</p>
					</div>
				</div>
			</section>

			{/* O QUE ELE SE RECUSA A FAZER */}
			<section className="vit-sec">
				<h2 className="vit-sec-titulo">
					Três coisas que ele se recusa a fazer
				</h2>
				<ul className="vit-recusas">
					{RECUSAS.map((r) => (
						<li key={r.titulo}>
							<h3>{r.titulo}</h3>
							<p>{r.texto}</p>
						</li>
					))}
				</ul>
			</section>

			{/* ACESSO + RODAPÉ */}
			<section className="vit-sec vit-pe">
				{children}
				<div className="vit-rodape">
					<span className="vit-stack">Next.js · Supabase · Telegram Bot</span>
					<a
						href="https://github.com/JaoVile/VaiGerar"
						target="_blank"
						rel="noopener noreferrer"
					>
						código no GitHub →
					</a>
				</div>
			</section>
		</div>
	);
}
