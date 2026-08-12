import { MESES_PADRAO, type SearchResult } from "@/lib/search/query";
import { escapeHtml, type InlineKeyboard } from "@/lib/telegram";

export function formatBRL(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Conta caracteres alfanuméricos (letra ou dígito Unicode) de uma string. */
function contarAlfanumericos(s: string): number {
  return (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

const REGEX_URL = /https?:\/\/\S+/i;

/**
 * Escolhe a linha do post que serve de título do link.
 *
 * Existia como `primeiraLinha` (primeira linha não-vazia do post). Defeito
 * medido em produção: buscando "samsung s25 plus", 44 de 53 resultados (83%)
 * mostravam um emoji (`🚨🚨`, `😱😱`, `🔥🔥`) como texto clicável — vários
 * canais abrem todo post com uma linha só de emoji.
 *
 * Medição contra 2.400 posts reais do arquivo, em 2026-08-11, taxa de título
 * ruim (emoji/vazio/frase genérica em vez do nome do produto):
 *
 *   critério                                                 títulos ruins
 *   primeira linha não-vazia (comportamento antigo)                19,3%
 *   primeira linha com 12+ caracteres alfanuméricos                  0%
 *   linha mais longa sem URL (por caracteres alfanuméricos)          0%
 *
 * Os dois últimos critérios zeram a métrica, mas só "linha mais longa"
 * escolhe o nome do produto — "12+ caracteres" costuma parar na primeira
 * frase de efeito do post ("Ative o cupom na página do produto!") em vez do
 * nome ("Samsung Galaxy S26 5G, 256 GB, 12 GB RAM | ATIVE O CUPOM + PIX").
 *
 * NÃO troque isso de volta por "primeira linha" sem repetir a medição —
 * é exatamente essa simplificação que reintroduz o defeito.
 *
 * "Mais longa" é contado em caracteres alfanuméricos, não em `.length` cru:
 * `.length` cru deixaria uma linha de puras emoji (que pesa vários code
 * units por causa de surrogate pairs / ZWJ) vencer uma linha de texto real
 * mais curta.
 *
 * Linha com URL é descartada inteira (não só a URL) — não vira título.
 * Se nenhuma linha qualificar (post sem nenhum caractere alfanumérico fora
 * de uma URL — ex.: só emoji), cai no comportamento antigo em vez de
 * devolver vazio.
 */
export function tituloDoPost(texto: string, max = 70): string {
  const linhas = texto
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let melhor: string | null = null;
  let melhorPontuacao = 0;
  for (const linha of linhas) {
    if (REGEX_URL.test(linha)) continue;
    const pontuacao = contarAlfanumericos(linha);
    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhor = linha;
    }
  }

  const escolhida = melhor ?? linhas[0] ?? texto.trim();
  return escolhida.length > max ? `${escolhida.slice(0, max)}…` : escolhida;
}

export function formatSearch(r: SearchResult): string {
  if (!r.stats || r.melhores.length === 0) {
    return `Não achei nada para <b>${escapeHtml(r.termo)}</b> nos últimos ${MESES_PADRAO} meses.\n\nTente um termo mais curto — "air fryer" acha mais que "air fryer 5 litros inox".`;
  }

  const linhas = [
    `🔎 <b>${escapeHtml(r.termo)}</b> — ${r.stats.count} ofertas nos últimos ${MESES_PADRAO} meses`,
    `menor ${formatBRL(r.stats.minCents)} · mediana <b>${formatBRL(r.stats.medianCents)}</b> · maior ${formatBRL(r.stats.maxCents)}`,
    "",
  ];

  for (const m of r.melhores) {
    const loja = m.store ? ` · ${escapeHtml(m.store)}` : "";
    linhas.push(
      `<b>${formatBRL(m.priceCents)}</b>${loja} · ${m.postedAt.slice(0, 10)}`,
      `<a href="${escapeHtml(m.url)}">${escapeHtml(tituloDoPost(m.text))}</a>`,
    );
    // `product_url` nem sempre leva direto à loja — em canais como o
    // `ctofertascelulares` é um encurtador do próprio canal. Por isso "ir
    // para a oferta", nunca "ir para a loja": não dá pra prometer o destino.
    if (m.productUrl) {
      linhas.push(`<a href="${escapeHtml(m.productUrl)}">ir para a oferta</a>`);
    }
    linhas.push("");
  }

  linhas.push(
    "<i>A mediana é a régua: preço muito abaixo dela costuma ser acessório, não o produto.</i>",
  );
  return linhas.join("\n");
}

export function formatSearchPagina(
  r: SearchResult,
  offset: number,
  porPagina: number,
): { texto: string; keyboard?: InlineKeyboard } {
  if (!r.stats || r.melhores.length === 0) {
    return { texto: formatSearch(r) };
  }

  const total = r.melhores.length;
  const fatia = r.melhores.slice(offset, offset + porPagina);

  const linhas = [
    `🔎 <b>${escapeHtml(r.termo)}</b> — ${r.stats.count} ofertas em ${MESES_PADRAO} meses`,
    `menor ${formatBRL(r.stats.minCents)} · mediana <b>${formatBRL(r.stats.medianCents)}</b> · maior ${formatBRL(r.stats.maxCents)}`,
    `<i>mostrando ${offset + 1}–${Math.min(offset + porPagina, total)} de ${total}</i>`,
    "",
  ];

  for (const m of fatia) {
    const loja = m.store ? ` · ${escapeHtml(m.store)}` : "";
    linhas.push(
      `<b>${formatBRL(m.priceCents)}</b>${loja} · ${m.postedAt.slice(0, 10)}`,
      `<a href="${escapeHtml(m.url)}">${escapeHtml(tituloDoPost(m.text))}</a>`,
    );
    if (m.productUrl) {
      linhas.push(`<a href="${escapeHtml(m.productUrl)}">ir para a oferta</a>`);
    }
    linhas.push("");
  }

  const botoes: Array<{ text: string; callback_data: string }> = [];
  if (offset > 0) {
    botoes.push({
      text: "◀ anteriores",
      callback_data: `pag:${Math.max(0, offset - porPagina)}`,
    });
  }
  if (offset + porPagina < total) {
    botoes.push({
      text: "mais ofertas ▶",
      callback_data: `pag:${offset + porPagina}`,
    });
  }

  return {
    texto: linhas.join("\n"),
    keyboard: botoes.length > 0 ? { inline_keyboard: [botoes] } : undefined,
  };
}

export type CacaResumo = {
  label: string;
  priceMinCents: number;
  priceMaxCents: number;
  melhorAtualCents: number | null;
  medianaCents: number | null;
};

/**
 * Rodapé do `/cacas`. Existe porque o melhor preço listado vem de `buscar`, que
 * lê a janela inteira de `MESES_PADRAO` meses — pode ser um post morto de três
 * meses atrás. O alerta, por outro lado, só olha post recente (`JANELA_HORAS`
 * em `lib/cron/alerts.ts`). Sem este aviso, uma caça cujo alvo está poucos por
 * cento abaixo do mínimo histórico aparece como "na faixa" em todas as linhas e
 * nenhum alerta chega — o usuário conclui que o bot achou o preço e fica
 * esperando por um aviso que nunca vai vir.
 */
const RODAPE_CACAS =
  "<i>O preço acima é o menor do arquivo de " +
  `${MESES_PADRAO} meses — pode ser de uma oferta já encerrada. ` +
  "Só te aviso quando ele reaparecer numa oferta recente.</i>";

export function formatCacas(itens: CacaResumo[]): string {
  const blocos = itens.map((c) => {
    const linhas = [
      `🎯 <b>${escapeHtml(c.label)}</b>`,
      `   sua faixa: ${formatBRL(c.priceMinCents)} a ${formatBRL(c.priceMaxCents)}`,
    ];
    if (c.melhorAtualCents === null) {
      linhas.push(`   <i>nenhuma oferta encontrada em ${MESES_PADRAO} meses</i>`);
    } else {
      // Rótulo com a janela explícita: "melhor agora" era mentira — `buscar` lê
      // os últimos MESES_PADRAO meses, não o que está de pé neste instante.
      const prefixo = `   melhor em ${MESES_PADRAO} meses: ${formatBRL(c.melhorAtualCents)}`;
      if (c.melhorAtualCents < c.priceMinCents) {
        // O piso é o que `casa()` (`lib/hunts/match.ts`) usa pra rejeitar
        // acessório. Chamar isso de "na faixa" fazia as duas features
        // discordarem sobre a mesma pergunta: a lista dizia que serve, o motor
        // de alerta excluía o mesmo preço.
        linhas.push(
          `${prefixo} — <b>abaixo do seu piso</b>: barato demais pra ser o produto (costuma ser acessório), por isso não vira alerta`,
        );
      } else if (c.melhorAtualCents <= c.priceMaxCents) {
        linhas.push(`${prefixo} — <b>já apareceu na sua faixa</b>`);
      } else {
        const acima = Math.round((c.melhorAtualCents / c.priceMaxCents - 1) * 100);
        // Arredondar pra baixo dava "0% acima do seu teto", que se lê como
        // contradição — qualquer coisa entre +0,01% e +0,49% caía aqui.
        linhas.push(
          acima === 0
            ? `${prefixo} — logo acima do seu teto`
            : `${prefixo} — ${acima}% acima do seu teto`,
        );
      }
    }
    if (c.medianaCents !== null) {
      linhas.push(`   mediana ${MESES_PADRAO} meses: ${formatBRL(c.medianaCents)}`);
    }
    return linhas.join("\n");
  });
  if (blocos.length === 0) return "";
  return `${blocos.join("\n\n")}\n\n${RODAPE_CACAS}`;
}

export function formatAjuda(): string {
  return [
    "🎯 <b>Caçador de Ofertas</b>",
    "",
    `Leio 13 canais de promoção do Telegram sem parar e guardo tudo num arquivo dos últimos ${MESES_PADRAO} meses.`,
    "Serve pra <b>qualquer produto</b> — não só celular. Eletro, cozinha, móveis, roupa, academia, importado da China.",
    "",
    "<b>━━━ Ver preço agora ━━━</b>",
    "",
    "/agora &lt;produto&gt; — ou só escreva o nome, sem comando:",
    "",
    "<code>/agora air fryer</code>",
    "<code>calça de academia</code>",
    "<code>mesa de cabeceira</code>",
    "",
    "Respondo com quantas ofertas apareceram, o menor preço, a <b>mediana</b> e as 5 mais baratas com link.",
    "",
    "<b>━━━ Por que a mediana ━━━</b>",
    "",
    "O menor preço engana — quase sempre é acessório ou erro de anúncio.",
    "A mediana é a régua: se air fryer tem mediana de R$ 300, pagar R$ 250 é bom e R$ 450 é caro.",
    "",
    "<b>━━━ Ser avisado quando baixar ━━━</b>",
    "",
    "/cacar — monto por conversa:",
    "1️⃣ qual produto",
    "2️⃣ <i>eu mostro quantas ofertas existem e a mediana</i>",
    "3️⃣ quanto você quer pagar",
    "4️⃣ tolerância (botões de 5%, 10% e 15%, cada um mostrando a faixa em reais)",
    "",
    "Depois disso eu te aviso sozinho quando aparecer na faixa. Não precisa ficar olhando.",
    "",
    "/cacas — lista suas caças, com botão de excluir",
    "/ajuda — esta mensagem",
    "",
    "<b>━━━ Dica ━━━</b>",
    "",
    "<b>Termo curto acha mais.</b>",
    "✅ <code>air fryer</code>  ❌ <code>air fryer 5 litros inox 220v</code>",
    "✅ <code>s25 plus</code>  ❌ <code>celular samsung galaxy s25 plus novo</code>",
  ].join("\n");
}
