import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readEnv } from "@/lib/env";

export function createDb(): SupabaseClient {
  const env = readEnv();
  return createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
