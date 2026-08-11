import type { SearchResult } from "@/lib/search/query";
import { escapeHtml } from "@/lib/telegram";

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
    return `Não achei nada para <b>${escapeHtml(r.termo)}</b> nos últimos 6 meses.\n\nTente um termo mais curto — "air fryer" acha mais que "air fryer 5 litros inox".`;
  }

  const linhas = [
    `🔎 <b>${escapeHtml(r.termo)}</b> — ${r.stats.count} ofertas nos últimos 6 meses`,
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

export function formatAjuda(): string {
  return [
    "<b>Caçador de Ofertas</b>",
    "",
    "/agora &lt;produto&gt; — busca no arquivo e mostra menor preço e mediana",
    "/cacar — cria uma caça por conversa; te aviso quando aparecer na faixa",
    "/cacas — lista suas caças, com botão de pausar e excluir",
    "/ajuda — esta mensagem",
    "",
    "<i>Escrever direto, sem comando, faz a mesma coisa que /agora.</i>",
  ].join("\n");
}
