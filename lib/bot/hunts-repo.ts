import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizar, variantes } from "@/lib/hunts/terms";

/** Termos que quase sempre indicam acessório ou item usado, não o produto. */
const PROIBIDOS_PADRAO = [
  "capa",
  "pelicula",
  "película",
  "carregador",
  "cabo",
  "suporte",
  "seminovo",
  "semi-novo",
  "recondicionado",
  "vitrine",
  "usado",
];

/**
 * Remove da lista de proibidos qualquer palavra que apareça no próprio produto.
 * Sem isso, `/cacar cabo usb-c` nasce com "cabo" em terms_any E em terms_none —
 * e como `casa()` checa o veto ANTES dos obrigatórios, a caça nunca dispara,
 * para sempre, sem erro nenhum.
 */
function proibidosPara(produto: string): string[] {
  const alvo = normalizar(produto);
  return PROIBIDOS_PADRAO.filter((p) => !alvo.includes(normalizar(p)));
}

export async function criarHunt(
  db: SupabaseClient,
  chatId: number,
  produto: string,
  alvoCents: number,
  tolerancePct: number,
): Promise<void> {
  const { error } = await db.from("hunts").insert({
    chat_id: chatId,
    label: produto,
    query: produto,
    terms_any: variantes(produto),
    terms_none: proibidosPara(produto),
    target_cents: alvoCents,
    tolerance_pct: tolerancePct,
  });
  if (error) throw new Error(`Criando caça "${produto}": ${error.message}`);
}

export async function listarHunts(
  db: SupabaseClient,
  chatId: number,
): Promise<
  Array<{
    id: string;
    label: string;
    priceMinCents: number;
    priceMaxCents: number;
    isActive: boolean;
  }>
> {
  const { data, error } = await db
    .from("hunts")
    .select("id,label,price_min_cents,price_max_cents,is_active")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Listando caças de ${chatId}: ${error.message}`);
  return (data ?? []).map((h) => ({
    id: h.id as string,
    label: h.label as string,
    priceMinCents: h.price_min_cents as number,
    priceMaxCents: h.price_max_cents as number,
    isActive: h.is_active as boolean,
  }));
}

/**
 * Desativa só se a caça pertencer a `chatId`. Sem esse filtro, qualquer chat
 * autorizado que digitasse `del:<uuid-de-outro>` desativaria caça alheia —
 * `ALLOWED_CHAT_IDS` é lista, mais de um chat é esperado.
 * Devolve se alguma linha foi de fato desativada, pra o router poder avisar
 * quando o id não existir ou não for do chat.
 */
export async function desativarHunt(
  db: SupabaseClient,
  huntId: string,
  chatId: number,
): Promise<boolean> {
  const { data, error } = await db
    .from("hunts")
    .update({ is_active: false })
    .eq("id", huntId)
    .eq("chat_id", chatId)
    .select("id");
  if (error) throw new Error(`Desativando caça ${huntId}: ${error.message}`);
  return (data ?? []).length > 0;
}
