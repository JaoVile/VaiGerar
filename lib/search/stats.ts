export type PriceStats = {
  count: number;
  minCents: number;
  medianCents: number;
  maxCents: number;
};

/**
 * Estatística do conjunto de preços de uma busca. A mediana é o número que
 * responde "esse preço é bom?" — o mínimo sozinho engana, porque costuma ser
 * um caso atípico.
 */
export function priceStats(cents: number[]): PriceStats | null {
  if (cents.length === 0) return null;
  const ord = [...cents].sort((a, b) => a - b);
  const meio = Math.floor(ord.length / 2);
  const mediana = ord.length % 2 === 1 ? ord[meio] : Math.round((ord[meio - 1] + ord[meio]) / 2);
  return {
    count: ord.length,
    minCents: ord[0],
    medianCents: mediana,
    maxCents: ord[ord.length - 1],
  };
}

/**
 * Fração da mediana abaixo da qual um resultado é considerado acessório, não
 * o produto buscado. Medido contra o arquivo real em 2026-08-11: 0.25 corta a
 * forma de silicone de R$10 numa busca por "air fryer" (mediana R$290) mas
 * mantém o Air Fryer Britânia de R$93; 0.40 já descarta earbud legítimo de
 * R$54 numa busca por "fone bluetooth" (mediana R$136).
 *
 * Isto NÃO resolve casamento semântico — "ventilador de mesa" numa busca por
 * "mesa" tem preço plausível e continua passando. Ver `docs/FOLLOW-UPS.md`.
 */
export const PISO_FRACAO = 0.25;

/** Descarta itens absurdamente abaixo da mediana. Puro — não altera a entrada. */
export function aplicarPiso<T extends { priceCents: number }>(
  itens: T[],
  medianaCents: number,
  fracao: number = PISO_FRACAO,
): T[] {
  const piso = medianaCents * fracao;
  return itens.filter((i) => i.priceCents >= piso);
}
