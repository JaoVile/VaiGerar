import { normalizar } from "@/lib/hunts/terms";

export type Hunt = {
  id: string;
  chatId: number;
  label: string;
  /** Termo original de busca (coluna `query`, `not null` em `hunts`) — usado para calcular a estatística de mercado no alerta. */
  query: string;
  termsAny: string[];
  termsNone: string[];
  priceMinCents: number;
  priceMaxCents: number;
};

/** Faixa a partir do alvo e da tolerância em porcento. Para pré-visualização no chat; as colunas geradas de `hunts` são autoritativas. Podem divergir em 1 centavo com tolerância fracionária. */
export function faixaDe(
  alvoCents: number,
  tolerancePct: number,
): { minCents: number; maxCents: number } {
  return {
    minCents: Math.round((alvoCents * (100 - tolerancePct)) / 100),
    maxCents: Math.round((alvoCents * (100 + tolerancePct)) / 100),
  };
}

/**
 * O piso de preço é o que mata acessório sem lista negra infinita: capa de
 * R$29 nunca cai na faixa de um aparelho de R$3.000.
 */
export function casa(texto: string, priceCents: number | null, hunt: Hunt): boolean {
  if (priceCents === null) return false;
  if (priceCents < hunt.priceMinCents || priceCents > hunt.priceMaxCents) return false;

  const t = normalizar(texto);
  if (hunt.termsNone.some((n) => t.includes(normalizar(n)))) return false;
  return hunt.termsAny.some((a) => t.includes(normalizar(a)));
}
