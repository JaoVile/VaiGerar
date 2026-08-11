import type { SupabaseClient } from "@supabase/supabase-js";
import type { FlowData, Step } from "@/lib/bot/flows/new-hunt";

const EXPIRA_MIN = 10;

export async function lerSessao(
  db: SupabaseClient,
  chatId: number,
): Promise<{ step: Step; data: FlowData } | null> {
  const { data, error } = await db
    .from("bot_sessions")
    .select("step,data,expires_at")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (error) throw new Error(`Lendo sessão de ${chatId}: ${error.message}`);
  if (!data) return null;
  if (new Date(data.expires_at as string) < new Date()) return null;
  return { step: data.step as Step, data: data.data as FlowData };
}

export async function salvarSessao(
  db: SupabaseClient,
  chatId: number,
  step: Step,
  dados: FlowData,
  agora: Date,
): Promise<void> {
  const expira = new Date(agora.getTime() + EXPIRA_MIN * 60_000);
  const { error } = await db.from("bot_sessions").upsert(
    {
      chat_id: chatId,
      flow: "new_hunt",
      step,
      data: dados,
      updated_at: agora.toISOString(),
      expires_at: expira.toISOString(),
    },
    { onConflict: "chat_id" },
  );
  if (error) throw new Error(`Salvando sessão de ${chatId}: ${error.message}`);
}

export async function limparSessao(db: SupabaseClient, chatId: number): Promise<void> {
  const { error } = await db.from("bot_sessions").delete().eq("chat_id", chatId);
  if (error) throw new Error(`Limpando sessão de ${chatId}: ${error.message}`);
}
