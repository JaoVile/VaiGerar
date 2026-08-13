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
  /** Compra mínima em centavos, quando o post informa. */
  pisoCents: number | null;
  /**
   * Desconto máximo em centavos ("10% OFF, limite de R$40").
   *
   * É o campo que mais muda a decisão e o que mais faltava: sem ele, "25% OFF"
   * num carrinho de R$ 2.000 parece R$ 500 de desconto quando o teto real é
   * R$ 60. Aparece em 4% dos posts com cupom.
   */
  tetoCents: number | null;
  /** Vantagens além do desconto ("frete grátis"). */
  beneficios: string[];
  /** Condições de uso ("1 uso por CPF", "itens selecionados"). */
  restricoes: string[];
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

/**
 * Valor do desconto.
 *
 * A porcentagem para em 90 de propósito. Com `\d{1,3}` qualquer número virava
 * desconto e a lista real do `/cupom amazon monitor` saiu com
 * **"FAMILIA — 106%"** — o 106 vinha da especificação do monitor (taxa de
 * cobertura de cor), não de desconto nenhum. Cupom acima de 90% não existe.
 *
 * O `(?<![\d,.])` não é enfeite: sem ele, limitar o número a 90 não resolve
 * nada, porque a regex casa o **"6%" de dentro de "106%"**. Foi o que
 * aconteceu na primeira tentativa desta correção.
 */
const RE_DESCONTO =
  /((?<![\d,.])(?:90|[1-8]?\d)\s*%|R\$\s*\d{1,4}(?:[.,]\d{2})?\s*(?:de\s+)?(?:off|desconto))/i;

/**
 * Compra mínima. As quatro formas abaixo saíram do arquivo real:
 *
 *   "10% OFF em compras acima de R$129"
 *   "10% off em compras a partir de R$ 200"
 *   "10% OFF ACIMA DE R$200"            (sem a palavra "compras")
 *   "R$ 100 off em compras a partir de R$ 999"
 *
 * Não pode casar "limite de R$40", que é o TETO do desconto — daí exigir
 * "acima"/"a partir", que o teto nunca usa.
 */
const RE_PISO = /(?:acima\s+de|a\s+partir\s+de)\s*R\$\s*([\d.,]+)/i;

/**
 * Desconto máximo. Formas observadas:
 *
 *   "limite de R$40"
 *   "limite de R$ 60 de desconto"
 *   "(limitado a R$ 50)"
 *   "LIMITADO A R$50 OFF"
 */
const RE_TETO = /(?:limitad[oa]s?\s+a|limite\s+de)\s*R\$\s*([\d.,]+)/i;

/**
 * Restrições, cada uma com o rótulo curto que aparece na mensagem.
 *
 * `prime` exige contexto de assinatura ("membros prime", "assinantes prime",
 * "exclusivo prime"): a palavra sozinha é nome de produto no arquivo — "Placa
 * Mãe Asus Prime A520m" casaria e viraria restrição inventada.
 */
const RESTRICOES: Array<[RegExp, string]> = [
  [/\b(?:1|uma?)\s*(?:utiliza[çc][ãa]o|uso)?\s*por\s+cpf|por\s+cpf/i, "1 uso por CPF"],
  [/\b(?:itens|produtos)\s+selecionados/i, "itens selecionados"],
  [
    /(?:membros?|assinantes?|exclusivo\s+(?:para\s+(?:membros?\s+)?)?)\s*prime/i,
    "só assinante Prime",
  ],
  [/meli\s*\+|meli\s*mais/i, "só assinante Meli+"],
  [/(?:s[oó]|apenas|exclusivo)\s+(?:no\s+|pelo\s+)?app/i, "só no app"],
  [/primeir[ao]\s+compra/i, "só na primeira compra"],
];

const BENEFICIOS: Array<[RegExp, string]> = [[/frete\s+gr[aá]tis/i, "frete grátis"]];

/**
 * "R$ 1.299,90" -> 129990. O ponto é separador de milhar em pt-BR e a vírgula
 * é decimal — trocar os dois de papel transformaria R$ 1.299 em R$ 1,29.
 */
function reaisParaCents(bruto: string): number | null {
  const limpo = bruto.replace(/\./g, "").replace(",", ".");
  const n = Number(limpo);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/**
 * Raio, em caracteres, em volta do código onde uma regra ainda é considerada
 * dele.
 *
 * Sem isso a atribuição fica errada na maioria dos posts: eles são anúncios de
 * PRODUTO que por acaso carregam um cupom, e o "Frete Grátis" ou o "assinantes
 * Meli+" que aparecem no meio deles são do produto, não do cupom. Renderizando
 * o /cupom real em 12/08 o resultado foi "APROVEITAESSA — frete grátis", que é
 * propaganda do anúncio creditada ao código.
 *
 * Medido nos posts de 3 dias de Amazon e Mercado Livre: o post inteiro produz
 * 254 atribuições, ±120 caracteres produz 131. Ou seja, **metade vinha de
 * texto que não tem nada a ver com o cupom**.
 *
 * 120 cobre as formas reais, todas coladas no código:
 *
 *   "10% OFF em compras acima de R$129, limite de R$40 Utilize o cupom: MARCOU"
 *   "Utilize o cupom: ALOCUPOM (Válido para 1 utilização por CPF ...)"
 *   "🏷CHEGOUPRIME - Assinantes prime R$ 100 off em compras a partir de R$ 999"
 */
const RAIO_REGRA = 120;

function vizinhanca(texto: string, inicio: number, tamanho: number): string {
  return texto.slice(Math.max(0, inicio - RAIO_REGRA), inicio + tamanho + RAIO_REGRA);
}

function rotulos(texto: string, tabela: Array<[RegExp, string]>): string[] {
  const achados: string[] = [];
  for (const [rx, rotulo] of tabela) {
    if (rx.test(texto) && !achados.includes(rotulo)) achados.push(rotulo);
  }
  return achados;
}

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

    // Regras lidas da vizinhança do código, não do post inteiro — ver
    // RAIO_REGRA. Cada código de um post com vários lê a sua própria volta.
    const perto = vizinhanca(texto, m.index ?? 0, m[0].length);
    const desconto = RE_DESCONTO.exec(perto);
    const piso = RE_PISO.exec(perto);
    const teto = RE_TETO.exec(perto);

    cupons.push({
      codigo,
      descontoTexto: desconto ? desconto[1].replace(/\s+/g, " ").trim() : null,
      pisoCents: piso ? reaisParaCents(piso[1]) : null,
      tetoCents: teto ? reaisParaCents(teto[1]) : null,
      beneficios: rotulos(perto, BENEFICIOS),
      restricoes: rotulos(perto, RESTRICOES),
    });
  }
  return cupons;
}
