import { normalizar } from "@/lib/hunts/terms";
import { casaTermo } from "@/lib/hunts/termo";

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
/**
 * Quanto acima do teto ainda vira aviso de aproximação.
 *
 * Medido em 13/08 sobre 3 meses, com dedup por preço e dia, nas 6 caças reais:
 *
 *   +5%    1,7 avisos/mês no total  —  0,3 nas três caças que o usuário disputa
 *   +8%    4,3                         2,7
 *   +10%   9,3                         6,7
 *   +15%  27,0                        17,3
 *
 * 8% é onde o aviso cobre as caças que interessam (elas estão 3%, 5% e 7%
 * acima do teto) sem virar rotina. A 15% chega quase todo dia, e aviso que
 * chega todo dia deixa de ser lido.
 */
export const MARGEM_AVISO = 0.08;

function passaNosTermos(texto: string, hunt: Hunt): boolean {
  const t = normalizar(texto);
  if (hunt.termsNone.some((n) => t.includes(normalizar(n)))) return false;
  return hunt.termsAny.some((a) => casaTermo(texto, a));
}

/**
 * O preço ficou até `MARGEM_AVISO` ACIMA do teto — não serve pro alerta, mas
 * o usuário quer saber que chegou perto.
 *
 * Existe porque as 6 caças têm alvo 2% a 7% abaixo do que o mercado já
 * praticou e nunca dispararam em 3 meses. Sem isto o sistema fica mudo mesmo
 * quando o preço encosta.
 */
export function casaPerto(texto: string, priceCents: number | null, hunt: Hunt): boolean {
  if (priceCents === null) return false;
  if (priceCents <= hunt.priceMaxCents) return false;
  if (priceCents > Math.round(hunt.priceMaxCents * (1 + MARGEM_AVISO))) return false;
  // Sem checagem de piso aqui: quem passou de `> priceMaxCents` já está acima
  // do piso por construção, já que o piso é sempre menor que o teto. A
  // primeira versão tinha essa linha e ela era código morto — a mutação
  // mostrou que apagá-la não quebrava teste nenhum, e a razão é que ela nunca
  // rodava. Preço mal lido (R$ 4,14) é barrado pela regra de estar acima do
  // teto, não pelo piso.
  return passaNosTermos(texto, hunt);
}

export function casa(texto: string, priceCents: number | null, hunt: Hunt): boolean {
  if (priceCents === null) return false;
  if (priceCents < hunt.priceMinCents || priceCents > hunt.priceMaxCents) return false;

  // `termsNone` continua por substring de propósito: é lista de veto, e ali
  // um falso positivo (rejeitar demais) custa muito menos que um falso
  // negativo (alertar sobre capa de celular). "capa" pegando "capinha" é o
  // comportamento desejado.
  //
  // `termsAny` passa pelo casamento por token — ver `lib/hunts/termo.ts` pro
  // número que justifica: 61% dos casamentos de `galaxy s25` por substring
  // eram outro aparelho da linha.
  return passaNosTermos(texto, hunt);
}
