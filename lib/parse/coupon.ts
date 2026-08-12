/**
 * Extração de código de cupom do texto do post.
 *
 * Medido sobre 10.000 posts reais do arquivo em 2026-08-12: **29,1% dos posts
 * carregam um código de cupom**, em 748 códigos distintos. A distribuição dos
 * formatos é bem concentrada:
 *
 *   "cupom: CODIGO" / "cupom CODIGO"   2.226 ocorrências
 *   "🎟 CODIGO" (emoji de ticket)         807
 *   "use o cupom CODIGO"                    4
 *   "código: CODIGO"                        1
 *
 * Este módulo é deliberadamente separado de `lib/parse/price.ts`: lá o cupom
 * é **ruído a descartar** (o valor do cupom lido como preço do produto foi o
 * defeito que contaminou 2.225 posts em 10/08); aqui ele é o dado. Misturar
 * os dois faria uma mudança de um lado quebrar o outro em silêncio.
 */

export type Cupom = {
  codigo: string;
  /** Texto do desconto como o post escreveu ("R$400 OFF", "15%"). */
  descontoTexto: string | null;
  /** Piso de compra em centavos, quando o post informa. */
  pisoCents: number | null;
};

/**
 * O flag `i` é obrigatório porque os posts escrevem "Cupom:", "CUPOM:" e
 * "cupom" — mas ele faz `[A-Z0-9]` casar minúscula também, e aí "cupom válido
 * até amanhã" viraria o código `válido`.
 *
 * Quem resolve isso é `pareceCodigo`, exigindo que o texto capturado já venha
 * em maiúsculas. Código de cupom nesses canais é sempre em caixa alta, então
 * a própria caixa serve de filtro e cobre muito mais casos do que uma lista
 * de palavras conseguiria.
 */
const RE_CODIGO = /(?:cupom|c[oó]digo|[🎟🏷🎫])\s*:?\s*([A-Z0-9][A-Z0-9._-]{3,24})\b/giu;

/**
 * Palavras que aparecem onde o código apareceria, mas são a frase apontando
 * pro código, não o código. Vistas no arquivo: "Use o cupom ABAIXO" (67
 * ocorrências de `SAIU`, 33 de `CALOR` são código de verdade; `ABAIXO` e
 * `ADEUS` não são).
 *
 * A lista pega só 10 dos 748 códigos extraídos — ou seja, a regex já acerta
 * ~99% sozinha. Ela existe pros casos que apareceriam no topo do `/cupom` e
 * fariam o comando parecer quebrado logo na primeira linha.
 */
const NAO_E_CODIGO = new Set([
  // Nome de loja: "cupom Amazon R$150" e "cupom Mercado Livre 15%" apareciam
  // como se AMAZON e MERCADO fossem códigos — foi o que a primeira lista real
  // do /cupom mostrou no topo, em 12/08. Cupom que *contém* nome de loja
  // (MELICUPOM, TUDOAMAZON) não é afetado: a comparação é do token inteiro.
  "ALIEXPRESS",
  "AMAZON",
  "BAHIA",
  "CASAS",
  "CENTAURO",
  "KABUM",
  "LIVRE",
  "MAGALU",
  "MAGAZINE",
  "MELI",
  "MERCADO",
  "NETSHOES",
  "SAMSUNG",
  "SHEIN",
  "SHOPEE",

  "ABAIXO",
  "ACIMA",
  "ADEUS",
  "AGORA",
  "APENAS",
  "AQUI",
  "ATENCAO",
  "CLIQUE",
  "CODIGO",
  "COMPRE",
  "CUPOM",
  "CUPONS",
  "DESCONTO",
  "ENTRE",
  "FRETE",
  "GRATIS",
  "HOJE",
  "LINK",
  "MAIS",
  "NOVA",
  "NOVO",
  "OFERTA",
  "OFERTAS",
  "PAGINA",
  "PRODUTO",
  "PRODUTOS",
  "PROMO",
  "SOMENTE",
  "TODOS",
  "VALOR",
  "VEJA",
]);

const RE_DESCONTO = /(\d{1,3}\s*%|R\$\s*\d{1,4}(?:[.,]\d{2})?\s*(?:de\s+)?(?:off|desconto))/i;
const RE_PISO =
  /(?:em compras?\s+(?:acima|a partir)\s+de|acima de|a partir de|em compras? de)\s*R\$\s*(\d{1,4})/i;

function pareceCodigo(bruto: string): boolean {
  // Ver o comentário de RE_CODIGO: o flag `i` existe pra casar "Cupom:" e
  // "CUPOM:", não pra aceitar código minúsculo. Sem esta linha, "cupom válido
  // até amanhã" vira o cupom `válido` — e nenhuma lista de palavras daria
  // conta da variedade de frases que aparecem depois da palavra cupom.
  if (bruto !== bruto.toUpperCase()) return false;
  const c = bruto.toUpperCase();
  if (NAO_E_CODIGO.has(c)) return false;
  // Só dígitos é quase sempre um valor solto ("cupom: 30" de "cupom de R$30").
  if (/^\d+$/.test(c)) return false;
  // Menos de 3 caracteres distintos é ruído ("AAAA", "----").
  if (new Set(c).size < 3) return false;
  return true;
}

export function extrairCupons(texto: string): Cupom[] {
  const desconto = RE_DESCONTO.exec(texto);
  const piso = RE_PISO.exec(texto);
  const pisoCents = piso ? Number(piso[1]) * 100 : null;

  const vistos = new Set<string>();
  const cupons: Cupom[] = [];
  // `matchAll` em vez de `exec` em laço: a regex é global e reusar `lastIndex`
  // entre chamadas já mordeu nesta base.
  for (const m of texto.matchAll(RE_CODIGO)) {
    const bruto = m[1];
    if (!pareceCodigo(bruto)) continue;
    const codigo = bruto.toUpperCase();
    if (vistos.has(codigo)) continue;
    vistos.add(codigo);
    cupons.push({
      codigo,
      descontoTexto: desconto ? desconto[1].replace(/\s+/g, " ").trim() : null,
      pisoCents,
    });
  }
  return cupons;
}
