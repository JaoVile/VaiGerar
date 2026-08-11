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

/**
 * Tamanho de lote padrão. Reduzido de 1000 pra 500 junto com a mudança pra
 * dois passos (ver comentário de `purgarLote`) porque o `.in("id", ids)` do
 * segundo passo vai na query string, e o supabase-js serializa a lista via
 * `URLSearchParams` — que percent-encoda vírgula e parênteses (form-encode
 * set), não só os dígitos. Medido: 1000 ids de 6 dígitos já fecham a URL em
 * ~8,2KB, em cima do limite comum de 8KB de header/request-line de proxies
 * (nginx default, vários LB) — e a tabela cresce (bigserial nunca reseta,
 * ~415 posts/dia), então os ids só ficam mais compridos com o tempo. 500 ids
 * fica em ~4-6KB mesmo com ids de 8 dígitos (décadas de crescimento no ritmo
 * atual), com folga real.
 */
const LOTE_PADRAO = 500;

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
 * que o PostgREST exige pra limitar de forma determinística) e devolve
 * quantas apagou de fato — mesmo espírito do `fim` de `/api/cron/reprocess`:
 * o operador (ou o próprio scheduler) chama de novo com o mesmo
 * `agora`/corte até a resposta trazer `fim: true`.
 *
 * DOIS PASSOS, NÃO UM DELETE COM `.limit()` — isso não é estilo, é
 * correção. Verificado empiricamente em produção em 2026-08-10: um
 * `.delete().lt(...).order(...).limit(1000).select("id")` recebeu
 * `lote = 1000` e apagou **6.806 linhas** numa chamada só (contagem antes:
 * 27.559; depois: 20.753) — o PostgREST aplica `order` e `select` num
 * DELETE, mas **ignora `limit`**. Hoje isso não dói porque o volume por
 * chamada ainda cabe no `maxDuration`; mas se a purga atrasar (cron
 * desligado por semanas, janela encurtada de novo), um DELETE de dezenas de
 * milhares de linhas estoura os 60s, o Postgres desfaz a transação inteira,
 * e a purga trava sem erro visível — cada chamada tenta tudo de novo,
 * estoura de novo, `apagados: 0` pra sempre. Por isso o limite é aplicado
 * onde o PostgREST de fato o honra (um SELECT) e só então usado para apagar
 * por lista de id. Não "simplifique" isto de volta pra um DELETE único sem
 * reverificar que o PostgREST passou a respeitar `limit` em DELETE.
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

  const { data: candidatos, error: erroSelect } = await db
    .from("posts")
    .select("id")
    .lt("posted_at", corte.toISOString())
    .order("id", { ascending: true })
    .limit(lote);
  if (erroSelect) throw new Error(`Selecionando posts a purgar: ${erroSelect.message}`);

  const ids = (candidatos ?? []).map((row: { id: number }) => row.id);
  if (ids.length === 0) return { apagados: 0, fim: true };

  const { error: erroDelete } = await db.from("posts").delete().in("id", ids);
  if (erroDelete) throw new Error(`Purgando posts: ${erroDelete.message}`);

  return { apagados: ids.length, fim: ids.length < lote };
}
