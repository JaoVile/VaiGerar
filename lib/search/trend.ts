import type { SupabaseClient } from "@supabase/supabase-js";
import { casaTermo } from "@/lib/hunts/termo";
import { MESES_PADRAO } from "@/lib/search/query";
import { priceStats } from "@/lib/search/stats";

/**
 * Tendência de preço por mês — "comprar agora ou esperar".
 *
 * ## O que a medição mostrou, e por que este módulo recusa responder
 *
 * O plano (`docs/PLANO-MELHORIAS.md`, item 4) desenhava uma reta caindo
 * bonitinho. Medido no arquivo real em 2026-08-12, mediana por mês:
 *
 *   galaxy s25 plus   R$ 4.174 -> R$ 3.999 -> R$ 3.799     tendência de verdade
 *   air fryer         R$   190 -> R$ 314 -> R$ 286 -> R$ 363   ruído
 *   fone bluetooth    R$    82 -> R$ 145 -> R$ 142 -> R$ 85    ruído
 *
 * Para "air fryer" a conta diria **"subiu 91% desde maio"**, o que é falso: o
 * que mudou foi o *mix de anúncios* (fritadeira de 3L num mês, de 12L no
 * outro), não o preço de mercado. Mediana mensal sobre conjunto heterogêneo
 * não é tendência de preço — é composição.
 *
 * ## Como o código separa os dois
 *
 * Pela **dispersão** dos preços, `(p75 - p25) / mediana`. Medido:
 *
 *   galaxy s25 plus   0,02        galaxy s25   0,04     <- produto único
 *   notebook          0,42        air fryer    0,65     <- categoria
 *   fone bluetooth    0,93
 *
 * A separação é de mais de dez vezes, então `LIMITE_DISPERSAO` no meio
 * (0,25) não é número escolhido a dedo: qualquer valor entre 0,05 e 0,40
 * classificaria a mesma coisa.
 *
 * Quando a dispersão é larga, o módulo devolve `calculavel: false` com o
 * motivo. Recusar é a resposta certa — uma reta falsa sobre "esperar ou
 * comprar agora" é pior que não responder.
 */

/** Acima disto o conjunto é categoria, não produto. Ver o bloco acima. */
export const LIMITE_DISPERSAO = 0.25;
/** Mínimo de anúncios num mês pra ele virar ponto do gráfico. */
export const MIN_POR_MES = 4;
/** Mínimo de meses com dado pra existir tendência. Dois pontos são uma reta, não uma tendência. */
export const MIN_MESES = 3;
const TETO_LINHAS = 2000;

export type MesTendencia = {
	/** "2026-08" */
	mes: string;
	medianCents: number;
	n: number;
};

export type Tendencia = {
	termo: string;
	meses: MesTendencia[];
	calculavel: boolean;
	/** Preenchido quando `calculavel` é falso. */
	motivo: "sem-dado" | "poucos-meses" | "categoria" | null;
	dispersao: number | null;
	/** Variação percentual do primeiro mês ao último. Negativo é queda. */
	variacaoPct: number | null;
	/** Variação média por mês, para a frase "caindo ~2%/mês". */
	variacaoPctMes: number | null;
};

function quantil(ordenados: number[], q: number): number {
	return ordenados[
		Math.min(ordenados.length - 1, Math.floor(q * ordenados.length))
	];
}

export function dispersaoDe(precos: number[]): number | null {
	if (precos.length < 2) return null;
	const ord = [...precos].sort((a, b) => a - b);
	const mediana = quantil(ord, 0.5);
	if (mediana <= 0) return null;
	return (quantil(ord, 0.75) - quantil(ord, 0.25)) / mediana;
}

export async function tendencia(
	db: SupabaseClient,
	termo: string,
): Promise<Tendencia> {
	const desde = new Date();
	desde.setMonth(desde.getMonth() - MESES_PADRAO);

	const { data, error } = await db
		.from("posts")
		.select("text,price_cents,posted_at")
		.textSearch("search_vector", termo, { type: "plain", config: "portuguese" })
		.not("price_cents", "is", null)
		.gte("posted_at", desde.toISOString())
		.limit(TETO_LINHAS);
	if (error) throw new Error(`Tendência de "${termo}": ${error.message}`);

	const linhas = (data ?? []) as Array<{
		text: string;
		price_cents: number;
		posted_at: string;
	}>;

	// Mesmo recorte do ranking da busca: sem isto a série de "galaxy s25"
	// carrega preço de S25 Ultra e a "tendência" vira composição de novo.
	const exatos = linhas.filter((l) => casaTermo(l.text, termo));
	const vazio: Tendencia = {
		termo,
		meses: [],
		calculavel: false,
		motivo: "sem-dado",
		dispersao: null,
		variacaoPct: null,
		variacaoPctMes: null,
	};
	if (exatos.length === 0) return vazio;

	const dispersao = dispersaoDe(exatos.map((e) => e.price_cents));

	const porMes = new Map<string, number[]>();
	for (const e of exatos) {
		const mes = e.posted_at.slice(0, 7);
		porMes.set(mes, [...(porMes.get(mes) ?? []), e.price_cents]);
	}
	const meses: MesTendencia[] = [...porMes.entries()]
		.filter(([, ps]) => ps.length >= MIN_POR_MES)
		.map(([mes, ps]) => ({
			mes,
			medianCents: priceStats(ps)?.medianCents ?? 0,
			n: ps.length,
		}))
		.sort((a, b) => a.mes.localeCompare(b.mes));

	// Ordem das recusas importa: "categoria" antes de "poucos meses". Um termo
	// de categoria com dado ralo deve ouvir que categoria não tem tendência, e
	// não que falta amostra — senão o usuário insiste esperando encher.
	if (dispersao !== null && dispersao > LIMITE_DISPERSAO) {
		return { ...vazio, meses, motivo: "categoria", dispersao };
	}
	if (meses.length < MIN_MESES) {
		return { ...vazio, meses, motivo: "poucos-meses", dispersao };
	}

	const primeiro = meses[0].medianCents;
	const ultimo = meses[meses.length - 1].medianCents;
	const variacaoPct = ((ultimo - primeiro) / primeiro) * 100;

	return {
		termo,
		meses,
		calculavel: true,
		motivo: null,
		dispersao,
		variacaoPct,
		variacaoPctMes: variacaoPct / (meses.length - 1),
	};
}
