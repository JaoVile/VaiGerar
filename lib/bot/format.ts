import { JANELA_HORAS } from "@/lib/cron/alerts";
import type { CacaAtual } from "@/lib/hunts/atual";
import type { ResultadoCupons } from "@/lib/search/coupons";
import { JANELA_HORAS as JANELA_HORAS_DIA, type ResumoDoDia } from "@/lib/search/digest";
import type { Tendencia } from "@/lib/search/trend";
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
 * Piso de conteúdo pra uma linha ser considerada nome de produto. Os 12
 * caracteres alfanuméricos saíram da medição de 11/08, onde já separavam
 * linha de efeito de linha de produto.
 */
const MIN_CONTEUDO = 12;

/**
 * Rodapé de aviso que os canais repetem em todo post. Não é lista inventada:
 * saiu da contagem de linhas que se repetem 5+ vezes num corte de 8.000 posts
 * reais (12/08). As mais frequentes, com a contagem medida:
 *
 *   2.126x  ⚠️ Preço e estoque sujeitos a alteração.
 *     691x  -Consulte disponibilidade para sua região
 *     521x  👉 Resgate todos os cupons disponíveis aqui:
 *     449x  O desconto entra apenas na tela de pagamento
 *
 * A intuição por trás: nome de produto é praticamente único no arquivo,
 * rodapé se repete centenas de vezes. A frequência é o detector; estes
 * padrões são só a forma barata de embutir o resultado dela no código.
 */
const REGEX_BOILERPLATE =
  /(sujeit\w+ a altera|preço e estoque|consulte disponibilidade|resgate (todos )?o?s? ?cupo|o desconto entra|na tela de pagamento|compare os fretes|uso limitado|antes que (expire|acabe)|aproveite antes|tempo limitado|acesse o link e pesquise|ative o cupom|use o cupom antes|desconto extra na compra|promoção (por|sujeita)|valores? sujeit|link p\/ comprar|^-?consulte)/i;

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
 *
 * SEGUNDA RODADA (12/08) — "linha mais longa" não bastava. Ao provar o alerta
 * em produção (item 1 do PLANO-MELHORIAS), o alerta chegou com o rodapé
 * "_*Promoção sujeita a alteração a qualquer momento_" como título: venceu o
 * nome do produto por 3 caracteres alfanuméricos (41 contra 38).
 *
 * A medição de 11/08 não pegou isso porque classificava título ruim como
 * emoji/vazio/genérico — aviso legal passava por texto legítimo.
 *
 * Nova medição, 8.000 posts reais. Para não medir de forma circular (filtrar
 * e avaliar com a mesma lista), a lista de rodapés foi derivada de uma metade
 * do arquivo e a taxa avaliada na outra:
 *
 *   critério                                          título de rodapé
 *   linha mais longa sem URL (1ª rodada)                        16,2%
 *   + só linhas antes do link de compra                          9,7%
 *   + descarta linha que casa REGEX_BOILERPLATE                  4,3%
 *   (+ lista de linhas exatas aprendida do arquivo)             (2,5%)
 *
 * A última linha exigiria uma tabela de rodapés mantida por cron; ficou de
 * fora por 1,8 ponto percentual. Está em `docs/FOLLOW-UPS.md`.
 */
export function tituloDoPost(texto: string, max = 70): string {
  const linhas = texto
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const semUrl = linhas.filter((l) => !REGEX_URL.test(l));
  // Corte estrutural: o que vem depois do link de comprar tende a ser rodapé,
  // não produto. É o filtro mais barato e sozinho já leva 16,2% a 9,7%.
  const indiceLink = linhas.findIndex((l) => REGEX_URL.test(l));
  const antesDoLink = indiceLink === -1 ? semUrl : linhas.slice(0, indiceLink);
  const temConteudo = (l: string) => contarAlfanumericos(l) >= MIN_CONTEUDO;
  const semRodape = (ls: string[]) => ls.filter((l) => !REGEX_BOILERPLATE.test(l));

  // Cascata de degradação, mesma ideia da rede de segurança do parser de
  // preço: cada grupo só vale se tiver linha, senão cai pro próximo. Post que
  // é *só* aviso legal mostra o aviso legal — nunca vazio, nunca lança.
  //
  // "Antes do link" é preferência, não veto. Alguns canais põem a URL antes
  // do nome do produto; vetar o que vem depois devolvia o emoji de abertura
  // como título — o defeito de 11/08 de volta. Por isso o segundo grupo relê
  // o post inteiro em vez de aceitar o que sobrou antes do link.
  const grupos = [
    semRodape(antesDoLink).filter(temConteudo),
    semRodape(semUrl).filter(temConteudo),
    semRodape(semUrl),
    semUrl,
  ];

  let melhor: string | null = null;
  for (const grupo of grupos) {
    let melhorPontuacao = 0;
    for (const linha of grupo) {
      const pontuacao = contarAlfanumericos(linha);
      if (pontuacao > melhorPontuacao) {
        melhorPontuacao = pontuacao;
        melhor = linha;
      }
    }
    if (melhor) break;
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

/**
 * Nome bonito da loja pra exibição. `posts.store` guarda o slug técnico
 * (`mercadolivre`), que fica feio numa lista pro usuário ler.
 */
const NOME_LOJA: Record<string, string> = {
  mercadolivre: "Mercado Livre",
  amazon: "Amazon",
  magalu: "Magalu",
  shopee: "Shopee",
  kabum: "KaBuM",
  aliexpress: "AliExpress",
  samsung: "Samsung",
  casasbahia: "Casas Bahia",
};

function nomeLoja(slug: string | null): string {
  if (!slug) return "loja não identificada";
  return NOME_LOJA[slug] ?? slug;
}

/** "hoje", "ontem", "há 2 dias" — validade não dá pra saber, idade dá. */
function idadeEmDias(iso: string, agora: Date): string {
  const dias = Math.floor((agora.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}

/**
 * O aviso não é enfeite: o post traz o código, nunca até quando ele vale.
 * Sem dizer isso, um cupom de 3 dias atrás que já morreu passa por "cupom
 * ativo" e o usuário culpa o bot. Mesmo princípio do rodapé do `/cacas`.
 */
const RODAPE_CUPONS =
  "<i>Os canais publicam o código, não a validade. " +
  "Por isso mostro há quanto tempo cada um saiu — os de hoje são a aposta melhor.</i>";

export function formatCupons(r: ResultadoCupons, agora: Date = new Date()): string {
  const alvo = r.loja ? nomeLoja(r.loja) : "todas as lojas";
  if (r.cupons.length === 0) {
    return [
      `Não achei cupom de <b>${escapeHtml(alvo)}</b> nos últimos ${r.dias} dias.`,
      "",
      "Tente <code>/cupom amazon</code>, <code>/cupom mercado livre</code>, <code>/cupom magalu</code> ou <code>/cupom shopee</code> — são as lojas com mais cupom no arquivo.",
    ].join("\n");
  }

  const linhas = [
    `🎟 <b>${escapeHtml(alvo)}</b> — ${r.cupons.length} cupons dos últimos ${r.dias} dias`,
    "",
  ];
  for (const c of r.cupons) {
    // Linha 1: o que o cupom DÁ. Sem o teto, "25% OFF" num carrinho de
    // R$ 2.000 parece R$ 500 de desconto quando o limite real é R$ 60 — é o
    // dado que mais muda a decisão de usar ou não.
    const ganho: string[] = [];
    if (c.descontoTexto) ganho.push(`<b>${escapeHtml(c.descontoTexto)}</b>`);
    if (c.tetoCents !== null) ganho.push(`no máximo ${formatBRL(c.tetoCents)}`);
    for (const b of c.beneficios) ganho.push(escapeHtml(b));
    if (!r.loja) ganho.push(nomeLoja(c.store));

    // Linha 2: o que o cupom EXIGE.
    const exige: string[] = [];
    if (c.pisoCents !== null) exige.push(`compra acima de ${formatBRL(c.pisoCents)}`);
    for (const x of c.restricoes) exige.push(escapeHtml(x));

    linhas.push(
      `<code>${escapeHtml(c.codigo)}</code>${ganho.length ? ` — ${ganho.join(" · ")}` : ""}`,
    );
    if (exige.length > 0) linhas.push(`   ⚠️ ${exige.join(" · ")}`);
    // Medido em 12/08: ~80% dos posts com cupom só trazem o código. Dizer isso
    // é melhor que deixar a linha nua e o usuário supor que não há regra —
    // supor "sem restrição" e tomar recusa no caixa é o pior desfecho.
    if (ganho.length === 0 && exige.length === 0) {
      linhas.push("   <i>o post não diz as regras — confira no link</i>");
    }
    linhas.push(
      `   <i>${idadeEmDias(c.postedAt, agora)}</i> · <a href="${escapeHtml(c.url)}">ver post</a>`,
      "",
    );
  }
  linhas.push(RODAPE_CUPONS);
  return linhas.join("\n");
}

const MES_CURTO = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

/** "2026-08" -> "ago". */
function rotuloMes(iso: string): string {
  const n = Number(iso.slice(5, 7));
  return MES_CURTO[n - 1] ?? iso;
}

const LARGURA_BARRA = 14;

/**
 * Barra proporcional ao preço, mas com a escala começando em 90% do menor mês
 * em vez de em zero.
 *
 * Com base zero as barras ficam todas do mesmo tamanho: uma queda de R$ 4.174
 * para R$ 3.799 é 9%, e 9% de diferença em 14 blocos é um bloco — o gráfico
 * não mostraria nada. A escala truncada é o que torna a variação visível, e
 * por isso os valores em reais ficam sempre ao lado: a barra é a forma da
 * curva, o número é a grandeza.
 */
function barra(cents: number, minCents: number, maxCents: number): string {
  const piso = minCents * 0.9;
  const vao = Math.max(maxCents - piso, 1);
  const n = Math.max(1, Math.round(((cents - piso) / vao) * LARGURA_BARRA));
  return "▇".repeat(n);
}

export function formatTendencia(t: Tendencia): string {
  const termo = escapeHtml(t.termo);

  if (!t.calculavel) {
    if (t.motivo === "categoria") {
      return [
        `Não dá pra calcular tendência de <b>${termo}</b>.`,
        "",
        "O preço varia demais entre os anúncios — é uma <b>categoria</b>, não um produto. A mediana mensal subiria e desceria porque o <b>mix</b> de anúncios muda (fritadeira de 3L num mês, de 12L no outro), não porque o mercado mudou.",
        "",
        "Tente um modelo específico: <code>/tendencia galaxy s25 plus</code>",
      ].join("\n");
    }
    if (t.motivo === "poucos-meses") {
      return [
        `Ainda não tenho <b>histórico</b> suficiente de <b>${termo}</b>.`,
        "",
        `Preciso de pelo menos 3 meses com anúncio suficiente em cada um. Hoje tenho ${t.meses.length}.`,
        "",
        `O arquivo guarda ${MESES_PADRAO} meses e vai enchendo sozinho — tente de novo em algumas semanas.`,
      ].join("\n");
    }
    return `Não achei anúncio de <b>${termo}</b> nos últimos ${MESES_PADRAO} meses.`;
  }

  const valores = t.meses.map((m) => m.medianCents);
  const min = Math.min(...valores);
  const max = Math.max(...valores);

  const linhas = [`📉 <b>${termo}</b> — mediana por mês`, ""];
  for (const m of t.meses) {
    linhas.push(
      `<code>${rotuloMes(m.mes)} ${formatBRL(m.medianCents).padStart(11)}</code> ${barra(m.medianCents, min, max)}`,
    );
  }

  const pctMes = Math.abs(t.variacaoPctMes ?? 0);
  const total = t.variacaoPct ?? 0;
  linhas.push("");
  if (Math.abs(total) < 2) {
    linhas.push("<b>→ estável</b> — o preço praticamente não mexeu no período.");
    linhas.push("<i>Sem sinal de que esperar vá ajudar.</i>");
  } else if (total < 0) {
    linhas.push(`<b>↓ caindo ~${pctMes.toFixed(0)}% ao mês</b> (${total.toFixed(0)}% no período)`);
    linhas.push("<i>Se dá pra esperar, esperar tem jogado a favor.</i>");
  } else {
    linhas.push(
      `<b>↑ subindo ~${pctMes.toFixed(0)}% ao mês</b> (+${total.toFixed(0)}% no período)`,
    );
    linhas.push("<i>Esperar não tem ajudado neste aqui.</i>");
  }

  // A ressalva fica sempre: cada ponto é a mediana de anúncios diferentes, não
  // o mesmo produto acompanhado no tempo. Sem dizer isso, o gráfico promete
  // uma precisão que o dado não tem.
  linhas.push(
    "",
    "<i>Cada mês é a mediana dos anúncios daquele mês, não o mesmo produto seguido no tempo.</i>",
  );
  return linhas.join("\n");
}

/**
 * Resposta do botão "menor preço agora" do `/cacas`.
 *
 * Diferente do corpo do `/cacas`, que mostra o menor do arquivo de
 * `MESES_PADRAO` meses (podendo ser oferta encerrada), aqui só entra o que
 * está dentro da janela do alerta. Por isso a mensagem repete a janela em
 * horas: as duas listas mostram preços diferentes de propósito, e sem o
 * rótulo isso pareceria contradição.
 */
export function formatMenorAtual(cacas: CacaAtual[], agora: Date = new Date()): string {
  if (cacas.length === 0) {
    return "Nenhuma caça ativa. Use /cacar para criar.";
  }

  const linhas = [`💰 <b>Menor preço agora</b> — ofertas das últimas ${JANELA_HORAS}h`, ""];
  for (const c of cacas) {
    linhas.push(`🎯 <b>${escapeHtml(c.label)}</b>`);
    if (c.achado === null) {
      linhas.push(
        `   <i>nada na sua faixa (${formatBRL(c.priceMinCents)} a ${formatBRL(c.priceMaxCents)}) nestas ${JANELA_HORAS}h</i>`,
      );
    } else {
      const a = c.achado;
      const loja = a.store ? ` · ${escapeHtml(a.store)}` : "";
      const horas = Math.max(
        0,
        Math.floor((agora.getTime() - new Date(a.postedAt).getTime()) / 3_600_000),
      );
      const quando = horas === 0 ? "agora há pouco" : `há ${horas}h`;
      linhas.push(
        `   <b>${formatBRL(a.priceCents)}</b>${loja} · ${quando}`,
        `   ${escapeHtml(tituloDoPost(a.text, 60))}`,
      );
      if (a.productUrl) {
        linhas.push(`   <a href="${escapeHtml(a.productUrl)}">ir para a oferta</a>`);
      }
      linhas.push(`   <a href="${escapeHtml(a.url)}">ver post</a>`);
    }
    linhas.push("");
  }

  linhas.push(
    `<i>Mesma janela e mesmo critério do alerta: o que aparece aqui é o que eu te avisaria. Se está em branco, é porque não apareceu nada na faixa nestas ${JANELA_HORAS}h — não é falha.</i>`,
  );
  return linhas.join("\n");
}

const NOME_SECAO: Record<string, string> = {
  tech: "💻 Tech e hardware",
  china: "📦 Importados",
  casa: "🏠 Casa e eletro",
  moda: "👕 Moda",
  geral: "🛒 Geral",
};

/**
 * Resumo do dia.
 *
 * Cada linha traz o preço de hoje **e a mediana do mesmo produto** — sem a
 * segunda, "-38%" é um número que o usuário tem que aceitar no escuro. Traz
 * também o tamanho da amostra: um desconto sustentado por 3 anúncios merece
 * menos fé que um sustentado por 58, e esconder isso seria vender certeza que
 * o dado não tem.
 */
export function formatResumo(r: ResumoDoDia, agora: Date = new Date()): string {
  const dia = agora.toISOString().slice(0, 10);
  if (r.secoes.length === 0) {
    return [
      `📊 <b>Resumo do dia</b> · ${dia}`,
      "",
      `Examinei ${r.examinados} ofertas das últimas ${JANELA_HORAS_DIA}h e <b>nenhuma</b> ficou claramente abaixo do preço histórico do próprio produto.`,
      "",
      "<i>Dia fraco acontece. Prefiro dizer isso a inventar destaque — se eu listasse os maiores descontos sem essa régua, o topo seria erro de leitura de preço.</i>",
    ].join("\n");
  }

  const total = r.secoes.reduce((n, s) => n + s.achados.length, 0);
  const linhas = [
    `📊 <b>Resumo do dia</b> · ${dia}`,
    `<i>${total} ofertas abaixo do preço histórico, de ${r.examinados} examinadas nas últimas ${JANELA_HORAS_DIA}h</i>`,
    "",
  ];

  for (const secao of r.secoes) {
    linhas.push(`<b>${NOME_SECAO[secao.kind] ?? secao.kind}</b>`, "");
    for (const a of secao.achados) {
      const loja = a.store ? ` · ${escapeHtml(a.store)}` : "";
      linhas.push(
        `<b>−${a.descontoPct}%</b> · <b>${formatBRL(a.priceCents)}</b>${loja}`,
        `   ${escapeHtml(a.titulo)}`,
        `   <i>vinha saindo por ${formatBRL(a.medianaCents)} (${a.amostra} anúncios)</i>`,
      );
      if (a.productUrl) {
        linhas.push(`   <a href="${escapeHtml(a.productUrl)}">ir para a oferta</a>`);
      }
      linhas.push(`   <a href="${escapeHtml(a.url)}">ver post</a>`, "");
    }
  }

  linhas.push(
    "<i>A régua é o próprio produto: comparo com a mediana dele nos últimos 30 dias, não com o resto do mercado. Por isso a lista é curta.</i>",
  );
  return linhas.join("\n");
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

/**
 * Quantos canais o coletor lê, só pra mensagem de ajuda.
 *
 * É número escrito à mão de propósito: contar de verdade exigiria uma
 * consulta ao banco dentro do `/ajuda`, que hoje não toca em banco nenhum e
 * responde instantâneo. O custo de errar é uma frase desatualizada; o custo
 * de consultar é uma ida ao banco a cada `/ajuda`.
 *
 * ATUALIZE ao cadastrar ou desativar canal. Ficou em 13 por dois dias depois
 * de o catálogo ir a 16, e ninguém percebeu.
 */
const CANAIS_MONITORADOS = 25;

export function formatAjuda(): string {
  return [
    "🎯 <b>Caçador de Ofertas</b>",
    "",
    `Leio ${CANAIS_MONITORADOS} canais de promoção do Telegram sem parar e guardo tudo num arquivo dos últimos ${MESES_PADRAO} meses.`,
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
    "Aparece um botão <b>mais ofertas ▶</b> embaixo: clicando, mostro as próximas 5, até 50 no total. Dá pra voltar com <b>◀ anteriores</b>.",
    "<i>Os botões param de funcionar 1 hora depois da busca — é só repetir o comando.</i>",
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
    "O aviso chega com o preço, quanto está abaixo do seu teto <b>e da mediana do mercado</b>, o nome do produto e o link direto da oferta.",
    "<i>Só aviso de oferta recente (últimas 48h) — não adianta te mandar promoção que já acabou.</i>",
    "<i>Se você começar um /cacar e mandar outro comando no meio, eu cancelo a conversa e aviso.</i>",
    "",
    "<b>━━━ O melhor do dia ━━━</b>",
    "",
    "/hoje — as ofertas das últimas 24h que estão <b>abaixo do preço histórico do próprio produto</b>, separadas por seção (tech, importados, casa, moda, geral).",
    "",
    "A régua é o próprio produto, não o mercado: comparo com a mediana dele nos últimos 30 dias. Por isso a lista é curta — costuma dar menos de 10.",
    '<i>Se eu ranqueasse por maior desconto, o topo seria erro de leitura de preço e post de cupom. Prefiro dizer "dia fraco" a inventar destaque.</i>',
    "",
    "<b>━━━ Comprar agora ou esperar ━━━</b>",
    "",
    "/tendencia &lt;modelo&gt; — como o preço andou nos últimos meses:",
    "",
    "<code>/tendencia galaxy s25 plus</code>",
    "",
    'Só vale pra <b>modelo específico</b>. Categoria como "air fryer" eu recuso, e explico: a mediana mensal mexeria porque o mix de anúncios muda, não porque o mercado mudou.',
    "",
    "<b>━━━ Cupom da loja ━━━</b>",
    "",
    "/cupom &lt;loja&gt; — os códigos que saíram nos últimos 3 dias:",
    "",
    "<code>/cupom amazon</code>",
    "<code>/cupom mercado livre</code>",
    "<code>/cupom magalu</code>",
    "",
    "Entendo apelido: <code>ml</code>, <code>meli</code>, <code>magazine luiza</code>.",
    "Os canais publicam o código, nunca a validade — por isso mostro há quantos dias cada um saiu.",
    "Quando o post declara, mostro também o desconto, o <b>teto</b> dele e as restrições (compra mínima, 1 uso por CPF, itens selecionados, só assinante).",
    "<i>Quando não declara, eu digo isso em vez de deixar você supor que não tem regra.</i>",
    "",
    "/cacas — lista suas caças, com botão de excluir",
    "",
    "No /cacas tem o botão <b>💰 Menor preço agora</b>: ele mostra, de cada caça, a oferta mais barata que está <b>de pé neste momento</b>.",
    `<i>A lista do /cacas usa o arquivo de ${MESES_PADRAO} meses e pode trazer promoção já encerrada. O botão usa a mesma janela de ${JANELA_HORAS}h do alerta — o que aparece nele é o que eu te avisaria.</i>`,
    "",
    "/ajuda — esta mensagem",
    "",
    "<i>Também respondo a /resumo, /cupons, /tendência e /start.</i>",
    "",
    "<b>━━━ Dica ━━━</b>",
    "",
    "<b>Termo curto acha mais.</b>",
    "✅ <code>air fryer</code>  ❌ <code>air fryer 5 litros inox 220v</code>",
    "✅ <code>s25 plus</code>  ❌ <code>celular samsung galaxy s25 plus novo</code>",
  ].join("\n");
}
