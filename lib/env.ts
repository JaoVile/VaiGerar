export type Env = {
  supabaseUrl: string;
  supabaseServiceKey: string;
  cronSecret: string;
};

const REQUIRED = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"] as const;

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const missing = REQUIRED.filter((k) => !source[k]);
  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente faltando: ${missing.join(", ")}`);
  }
  return {
    supabaseUrl: source.SUPABASE_URL as string,
    supabaseServiceKey: source.SUPABASE_SERVICE_ROLE_KEY as string,
    cronSecret: source.CRON_SECRET as string,
  };
}
