const STRIKE_RE = /<(s|del|strike)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BR_RE = /<br\s*\/?>/gi;
const TAG_RE = /<[^>]+>/g;
const PRICE_RE = /R\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)/gi;
const INSTALLMENT_RE = /\d{1,2}\s*x\s*(?:de\s*)?$/i;
/**
 * Marcador de cupom imediatamente antes do valor. A janela de 24 caracteres é
 * curta de propósito: "cupom de R$ 80" casa, mas um post que cita "cupom" num
 * parágrafo e o preço em outro não é afetado.
 */
const COUPON_BEFORE_RE = /(cupom|desconto|resgate|voucher|c[oó]digo)[^.\n]{0,14}$/i;
/** "R$ 30 OFF" — o marcador vem DEPOIS do valor. */
const COUPON_AFTER_RE = /^\s*(off|de desconto)\b/i;

/**
 * Formatos em que o valor **inequivocamente** não é preço de produto. Medido
 * em 12/08 passando os textos reais pelo parser:
 *
 *   "18% de desconto em R$29 (Limitado R$500)"   virava preço R$ 500,00
 *   "R$15 de desconto em R$75"                   virava preço R$ 15,00
 *   "20% de desconto em R$39 (Limite de R$50)"   virava preço R$ 50,00
 *   "🎟 BRASILPRIME + R$200 na finalização"       virava preço R$ 200,00
 *
 * São três coisas distintas — piso de compra, teto do desconto e valor do
 * cupom — e nenhuma é o que o produto custa.
 *
 * A diferença para `COUPON_BEFORE_RE`/`COUPON_AFTER_RE` não é o tipo de erro,
 * é a **confiança**: ali o marcador é uma palavra solta perto do número, que
 * pode aparecer num post legítimo; aqui é a frase inteira. Por isso estes
 * descartes ignoram a rede de segurança (ver `parsePrices`).
 */
const CUPOM_FORTE_ANTES: RegExp[] = [
  // piso de compra logo depois de um desconto declarado:
  //   "18% de desconto em R$29"      "10% off acima de R$ 200"
  /(?:%|R\$\s*[\d.,]+)\s*(?:de\s+)?(?:desconto|off)\s+(?:em\s+compras?\s+)?(?:em|acima\s+de|a\s+partir\s+de)\s*R?\$?\s*$/i,
  // teto do desconto: "(Limitado R$", "Limite de R$"
  /limitad[oa]s?\s*(?:a\s*)?R?\$?\s*$|limite\s+de\s*R?\$?\s*$|m[aá]x(?:imo)?\.?\s+de\s*R?\$?\s*$|\blim\.?\s*(?:de\s*)?R?\$?\s*$/i,
  // "10% OFF até R$ 2500" — o "até" só é teto no contexto de desconto; sozinho
  // aparece em post de produto ("parcelas até 10x") e não pode virar descarte.
  /(?:%|off|desconto)[^.\n]{0,14}\bat[eé]\s*R?\$?\s*$/i,
  // "Compras acima de R$399" — piso de compra que não precisa do contexto de
  // desconto por perto: a frase já diz o que o valor é. Existe separado porque
  // vários canais põem o piso longe do "% OFF", fora da janela de 44.
  /\bcompras?\s+(?:acima\s+de|a\s+partir\s+de)\s*R?\$?\s*$/i,
];

/**
 * Frases que confirmam depois do valor.
 *
 * A janela precisa ser maior que a do filtro fraco: "+ R$200 na finalização"
 * tem 16 caracteres só até "na ", e a checagem cortava antes da palavra que
 * decide. Foi o que fez a primeira versão deste descarte não pegar
 * "Cupom BRASIL10 + R$50 de desconto na finalização".
 */
const CUPOM_FORTE_DEPOIS: RegExp[] = [
  /^\s*(?:de\s+desconto\s+)?na\s+finaliza/i,
  /^\s*de\s+desconto\s+em\s*R\$/i,
];

/** Caracteres olhados em volta do valor nos descartes fortes. */
const JANELA_FORTE_ANTES = 44;
const JANELA_FORTE_DEPOIS = 34;

/** Piso: abaixo de R$1,00 é cupom/frete/centavo solto, não preço de produto. */
const MIN_PRICE_CENTS = 100;

/**
 * Teto: R$5.000.000,00. Canal de oferta anuncia celular, eletrônico e importado —
 * nada acima de alguns milhões de reais é oferta de verdade; acima disso é ruído
 * (número de telefone/CEP colado no cifrão, valor de sorteio, "carro por R$
 * 25.000.000"). O teto também protege a coluna `price_cents`, que é `integer` no
 * Postgres: `int4` vai até 2.147.483.647 (R$21.474.836,47), e um único valor acima
 * disso derruba o `upsert` do lote inteiro — no backfill isso é permanente, porque
 * a mesma página é rebuscada a cada invocação e o cursor nunca avança. R$5M deixa
 * margem larga abaixo do overflow e ainda assim descarta só o que é ruído.
 */
const MAX_PRICE_CENTS = 500_000_000;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Code point válido pra `String.fromCodePoint` sem lançar RangeError. */
function isValidCodePoint(codePoint: number): boolean {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff;
}

/** HTML do post → texto puro, descartando o que estiver riscado (preço velho). */
export function htmlToText(html: string): string {
  const withoutStrike = html.replace(STRIKE_RE, " ");
  const withBreaks = withoutStrike.replace(BR_RE, "\n");
  const stripped = withBreaks.replace(TAG_RE, "");
  // Telegram escapa caracteres como "$" em referências numéricas (ex.: "R&#036;"
  // vira "R$"), não só nas entidades nomeadas — decodifica as duas formas, antes
  // das nomeadas (senão "&amp;#036;" viraria "$" em vez de "&#036;" literal).
  // Code point inválido/malformado (ex.: &#99999999;) devolve a sequência
  // original em vez de lançar — um post excêntrico não pode derrubar o canal.
  const withNumericEntities = stripped
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&#(\d+);/g, (match, dec: string) => {
      const codePoint = Number.parseInt(dec, 10);
      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : match;
    });
  return withNumericEntities.replace(
    /&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g,
    (m) => ENTITIES[m] ?? m,
  );
}

/** "3.149,10" → 314910. Ponto é milhar, vírgula é decimal (formato BR). */
export function toCents(raw: string): number | null {
  const hasComma = raw.includes(",");
  const normalized = hasComma ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/\./g, "");
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/**
 * Extrai todos os preços válidos do post.
 * Descarta parcela ("12x de R$ 274,91"), preço riscado e o que cai fora da
 * faixa plausível [MIN_PRICE_CENTS, MAX_PRICE_CENTS].
 * `priceCents` é o menor — o preço Pix, que é o que vale.
 */
export function parsePrices(html: string): {
  pricesCents: number[];
  priceCents: number | null;
} {
  const text = htmlToText(html);

  // Rede de segurança: calcula dois conjuntos — com e sem filtro de cupom.
  // Se o filtro de cupom zera o resultado mas há preços sem o filtro,
  // usa os preços sem filtro. Isso previne que o filtro transforme um post
  // com preço num post sem preço.
  const foundWithCouponFilter: number[] = [];
  const foundWithoutCouponFilter: number[] = [];
  // Valores descartados com confiança alta. Não entram nem na rede de
  // segurança: ver CUPOM_FORTE_ANTES.
  let descartesFortes = 0;

  for (const match of text.matchAll(PRICE_RE)) {
    const at = match.index ?? 0;
    const before = text.slice(Math.max(0, at - 24), at);
    if (INSTALLMENT_RE.test(before)) continue;

    const after = text.slice(at + match[0].length, at + match[0].length + 16);

    const cents = toCents(match[1]);
    if (cents === null) continue;
    if (cents < MIN_PRICE_CENTS || cents > MAX_PRICE_CENTS) continue;

    // Descarte forte: a frase inteira diz que o valor não é o produto. Fica
    // fora dos DOIS conjuntos, então a rede de segurança não o ressuscita.
    const antesLongo = text.slice(Math.max(0, at - JANELA_FORTE_ANTES), at);
    const depoisLongo = text.slice(
      at + match[0].length,
      at + match[0].length + JANELA_FORTE_DEPOIS,
    );
    if (
      CUPOM_FORTE_ANTES.some((re) => re.test(antesLongo)) ||
      CUPOM_FORTE_DEPOIS.some((re) => re.test(depoisLongo))
    ) {
      descartesFortes++;
      continue;
    }

    // Adiciona ao conjunto sem filtro de cupom
    foundWithoutCouponFilter.push(cents);

    // Descarta cupom para o conjunto com filtro
    if (COUPON_BEFORE_RE.test(before)) continue;
    if (COUPON_AFTER_RE.test(after)) continue;

    foundWithCouponFilter.push(cents);
  }

  // Rede de segurança: se o filtro FRACO zerou a lista, volta ao conjunto sem
  // ele — um post com preço nunca pode virar post sem preço por causa de uma
  // palavra solta.
  //
  // Ela não vale quando os únicos valores do post foram descartados por
  // formato forte: aí o post é lista de cupom mesmo, e "sem preço" é a
  // resposta certa. Sem esta ressalva o descarte forte seria inútil — a rede
  // devolveria exatamente o valor que ele acabou de tirar.
  // A rede só age quando o descarte foi todo FRACO. Se houve descarte forte e
  // nada sobreviveu ao filtro de cupom, todos os valores do post eram de
  // cupom — é lista de cupom, e "sem preço" é a resposta certa.
  //
  // Medido em 10.000 posts: sem esta condição, "10% OFF em R$ 200, máx de
  // R$ 40 OFF" trocava um preço errado (R$ 200) por outro (R$ 40), e
  // "R$ 10 OFF em R$ 40" virava R$ 10 — os dois piores para a mediana, por
  // serem pequenos.
  if (foundWithCouponFilter.length === 0 && descartesFortes > 0) {
    return { pricesCents: [], priceCents: null };
  }
  const found = foundWithCouponFilter.length > 0 ? foundWithCouponFilter : foundWithoutCouponFilter;

  const pricesCents = [...new Set(found)].sort((a, b) => a - b);
  return { pricesCents, priceCents: pricesCents[0] ?? null };
}
