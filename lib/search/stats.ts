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
