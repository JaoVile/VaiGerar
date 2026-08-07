import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
	readFileSync(".env.local", "utf8")
		.split("\n")
		.filter((l) => l.includes("="))
		.map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Mesmo conteúdo de supabase/migrations/0002_seed_channels.sql, aplicado via
// supabase-js porque o SQL Editor do Supabase não é scriptável daqui.
// upsert com onConflict + ignoreDuplicates reproduz "on conflict do nothing".
const channels = [
	{ slug: "ctofertascelulares", title: "CT Ofertas | Celulares", kind: "tech" },
	{ slug: "TudoPromo", title: "TudoPromo (TudoCelular)", kind: "tech" },
	{ slug: "jgtechofertas", title: "JG Ofertas", kind: "tech" },
	{ slug: "gtOFERTAS", title: "gt.OFERTAS", kind: "tech" },
	{ slug: "Chinacuponsbr", title: "China Cupons BR", kind: "china" },
	{
		slug: "CuponsAliExpressChinaCuponsBR",
		title: "Cupons AliExpress",
		kind: "china",
	},
	{
		slug: "AliexpresspromocoesecuponsBR",
		title: "AliExpress Promoções BR",
		kind: "china",
	},
];

const { data, error } = await db
	.from("channels")
	.upsert(channels, { onConflict: "slug", ignoreDuplicates: true })
	.select("slug");

if (error) {
	console.error(`FALHOU seed: ${error.message}`);
	process.exit(1);
}

console.log(`ok seed (${data.length} linha(s) inserida(s) nesta rodada)`);

const { data: all, error: err2 } = await db
	.from("channels")
	.select("slug, title, kind")
	.order("slug");
if (err2) {
	console.error(`FALHOU leitura: ${err2.message}`);
	process.exit(1);
}
console.log(`total de canais na tabela: ${all.length}`);
for (const c of all) console.log(`  ${c.slug} (${c.kind})`);
