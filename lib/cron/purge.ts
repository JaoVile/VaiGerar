import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Janela de retenção do arquivo. Precisa andar junto com `MESES_PADRAO`
 * (`lib/search/query.ts`) e `BACKFILL_MONTHS` (`lib/cron/backfill.ts`): as
 * três controlam a mesma janela rolante de 3 meses vista de três ângulos —
 * o que a busca enxerga, até onde o backfill baixa do `t.me`, e o que a
 * purga apaga. Se só esta mudar, a purga passa a apagar dado que a busca
 * ainda promete mostrar (ou vice-versa); se só o backfill ficar maior, ele
 * baixa posts que a purga em seguida apaga, gastando requisição à toa contra
 * um serviço de terceiro pra sempre. Mude as três juntas.
 */
export const PURGE_MONTHS = 3;

const LOTE_PADRAO = 1000;

export type PurgeReport = {
  /** Quantas linhas este lote apagou. */
  apagados: number;
  /** `true` quando o lote apagou menos que o tamanho pedido — não sobrou nada além do corte. */
  fim: boolean;
};

/**
 * Data de corte da purga: post com `posted_at` anterior a isto é apagado.
 * Pura — recebe `agora` por parâmetro, não lê relógio (mesmo padrão de
 * `oldestAllowedFrom` em `lib/cron/backfill.ts`).
 */
export function corteDePurga(agora: Date, meses: number = PURGE_MONTHS): Date {
  const d = new Date(agora);
  d.setMonth(d.getMonth() - meses);
  return d;
}

/**
 * Apaga um lote de posts mais velhos que a janela de retenção.
 *
 * Lote existe por causa do `maxDuration` de 60s da rota: um DELETE de
 * dezenas de milhares de linhas de uma vez pode estourar o tempo do
 * request. Cada chamada apaga no máximo `lote` linhas (ordenadas por `id`,
 * que o PostgREST exige pra limitar um DELETE de forma determinística) e
 * devolve quantas apagou de fato — mesmo espírito do `fim` de
 * `/api/cron/reprocess`: o operador (ou o próprio scheduler) chama de novo
 * com o mesmo `agora`/corte até a resposta trazer `fim: true`.
 *
 * ATENÇÃO — efeito cascata intencional: `alerts.post_row_id` referencia
 * `posts(id) on delete cascade` (`supabase/migrations/0001_schema.sql`).
 * Apagar um post apaga junto qualquer alerta que aponte pra ele — inclusive
 * alerta já enviado, que era o único registro de "esse post já foi avisado".
 * Isso é aceitável de propósito: alerta é notificação efêmera, não registro
 * contábil. Quem mexer aqui precisa saber que o cascade é intencional, não
 * um bug de FK a "corrigir".
 */
export async function purgarLote(
  db: SupabaseClient,
  agora: Date,
  meses: number = PURGE_MONTHS,
  lote: number = LOTE_PADRAO,
): Promise<PurgeReport> {
  const corte = corteDePurga(agora, meses);

  const { data, error } = await db
    .from("posts")
    .delete()
    .lt("posted_at", corte.toISOString())
    .order("id", { ascending: true })
    .limit(lote)
    .select("id");
  if (error) throw new Error(`Purgando posts: ${error.message}`);

  const apagados = (data ?? []).length;
  return { apagados, fim: apagados < lote };
}
