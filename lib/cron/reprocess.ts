export type PrecosNovos = {
  priceCents: number | null;
  pricesCents: number[];
};

export type ReprocessDecision =
  | { action: "manter" }
  | { action: "pular-perderia-preco" }
  | { action: "atualizar"; priceCents: number | null; pricesCents: number[] };

/**
 * Decide o que fazer com o resultado de reprocessar um post. Puro — não toca
 * banco.
 *
 * Nunca troca um preço válido por `null`: se o parser não achou nada num post
 * que antes tinha um valor, isso é sinal de regressão do parser ou de um post
 * atípico, não motivo pra apagar um preço bom. Perder preço é decisão
 * consciente do operador (via `pulados` no relatório), não efeito colateral.
 */
export function decideReprocesso(precoAntigo: number | null, novo: PrecosNovos): ReprocessDecision {
  if (novo.priceCents === precoAntigo) return { action: "manter" };
  if (novo.priceCents === null && precoAntigo !== null) {
    return { action: "pular-perderia-preco" };
  }
  return {
    action: "atualizar",
    priceCents: novo.priceCents,
    pricesCents: novo.pricesCents,
  };
}
