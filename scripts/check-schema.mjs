import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const tables = ["channels", "posts", "hunts", "alerts", "user_settings", "bot_sessions"];
let ok = true;
for (const t of tables) {
  const { error } = await db.from(t).select("*").limit(0);
  console.log(error ? `FALHOU ${t}: ${error.message}` : `ok ${t}`);
  if (error) ok = false;
}
process.exit(ok ? 0 : 1);
