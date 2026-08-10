import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelRow } from "@/lib/db/types";

/**
 * Fake de `db` pra testar `backfillOnce` e `ingestAll` sem banco.
 *
 * A dependência de Supabase nessas funções é aparente, não real: elas usam um
 * punhado de métodos do query builder (`from().select().eq()`,
 * `from().update().eq().lt()`, `from().upsert()`), todos terminando num
 * `await`. Este objeto implementa só isso e registra o que foi escrito, que é
 * justamente o que os testes precisam observar — em especial se
 * `backfill_complete` foi (ou não) gravado.
 */

type QueryResult<T> = { data: T; error: { message: string } | null };

/** Builder encadeável que também é await-able. */
type QueryBox<T> = Promise<QueryResult<T>> & {
  eq: (column: string, value: unknown) => QueryBox<T>;
  lt: (column: string, value: unknown) => QueryBox<T>;
};

function queryBox<T>(
  result: QueryResult<T>,
  onFilter?: (column: string, value: unknown) => void,
): QueryBox<T> {
  const box = Promise.resolve(result) as QueryBox<T>;
  box.eq = (column, value) => {
    onFilter?.(column, value);
    return box;
  };
  box.lt = (column, value) => {
    onFilter?.(column, value);
    return box;
  };
  return box;
}

export type RecordedUpdate = {
  table: string;
  patch: Record<string, unknown>;
  filters: Record<string, unknown>;
};

export type RecordedUpsert = {
  table: string;
  rows: unknown[];
};

export type FakeDb = {
  /** Passe pra `backfillOnce`/`ingestAll` no lugar do cliente real. */
  client: SupabaseClient;
  updates: RecordedUpdate[];
  upserts: RecordedUpsert[];
};

export type FakeDbOptions = {
  /** Erro na leitura da tabela `channels` (faz as funções lançarem). */
  selectError?: string;
  /** Erro no `upsert` de posts — simula linha venenosa derrubando o lote. */
  upsertError?: string;
};

export function createFakeDb(channels: ChannelRow[], options: FakeDbOptions = {}): FakeDb {
  const updates: RecordedUpdate[] = [];
  const upserts: RecordedUpsert[] = [];

  const from = (table: string) => ({
    select: () =>
      queryBox<ChannelRow[]>({
        data: table === "channels" ? channels : [],
        error: options.selectError !== undefined ? { message: options.selectError } : null,
      }),

    update: (patch: Record<string, unknown>) => {
      const recorded: RecordedUpdate = { table, patch, filters: {} };
      updates.push(recorded);
      return queryBox<null>({ data: null, error: null }, (column, value) => {
        recorded.filters[column] = value;
      });
    },

    upsert: (rows: unknown[]) => {
      upserts.push({ table, rows });
      return queryBox<null>({
        data: null,
        error: options.upsertError !== undefined ? { message: options.upsertError } : null,
      });
    },
  });

  return {
    client: { from } as unknown as SupabaseClient,
    updates,
    upserts,
  };
}

/**
 * Fake de `globalThis.fetch` pra `fetchChannelPage`: casa o slug pela URL.
 * Slug ausente do mapa devolve 404, que é como um canal quebrado se comporta.
 */
export function fakeFetch(pages: Record<string, string>) {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    const slug = Object.keys(pages).find((s) => url.includes(`/s/${s}`));
    if (slug === undefined) {
      return new Response("não encontrado", { status: 404 });
    }
    return new Response(pages[slug], { status: 200 });
  };
}

export function channel(over: Partial<ChannelRow> = {}): ChannelRow {
  return {
    slug: "canal",
    title: null,
    kind: "tech",
    is_active: true,
    last_post_id: 0,
    backfill_cursor: null,
    backfill_complete: false,
    ...over,
  };
}
