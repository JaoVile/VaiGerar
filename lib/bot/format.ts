import { MESES_PADRAO, type SearchResult } from "@/lib/search/query";
import { escapeHtml, type InlineKeyboard } from "@/lib/telegram";

export function formatBRL(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function primeiraLinha(texto: string, max = 70): string {
  const limpo = texto.split("\n").find((l) => l.trim().length > 0) ?? texto;
  const t = limpo.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
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
      `<a href="${escapeHtml(m.url)}">${escapeHtml(primeiraLinha(m.text))}</a>`,
      "",
    );
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
      `<a href="${escapeHtml(m.url)}">${escapeHtml(primeiraLinha(m.text))}</a>`,
      "",
    );
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
