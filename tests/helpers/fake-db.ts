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
 * Fake de `db` mais geral, pra `processarAlertas`.
 *
 * O `createFakeDb` acima só cobre o que backfill/ingest usam. O caminho de
 * alerta é outro bicho: encadeia `.is()`, `.lt()`, `.or()`, `.gte()`,
 * `.not()`, `.order()`, `.limit()`, `.single()` e termina o `update` num
 * `.select("id")` — e o que os testes precisam observar é exatamente
 * **quais filtros foram aplicados**, porque a corretude do claim/lease mora
 * neles (um `.or()` que virasse no-op não mudaria nada visível de outro
 * jeito). Por isso este fake registra cada método da cadeia com seus
 * argumentos, na ordem.
 *
 * As respostas são configuradas por (operação, tabela). `.single()` devolve a
 * primeira linha da resposta configurada para aquele select.
 */
export type RecordedCall = { method: string; args: unknown[] };

export type RecordedQuery = {
  table: string;
  op: "select" | "update" | "upsert" | "insert" | "delete";
  /** Patch do `update`/linhas do `upsert`; ausente no `select`. */
  patch?: Record<string, unknown>;
  rows?: unknown[];
  calls: RecordedCall[];
};

type Linhas = Record<string, unknown>[];

export type QueryFakeRespostas = {
  /** Linhas devolvidas por `from(tabela).select(...)`. */
  select?: Record<string, Linhas>;
  /** Linhas devolvidas por `from(tabela).update(...).select(...)`. */
  update?: Record<string, Linhas>;
  /** Linhas devolvidas por `from(tabela).upsert(...).select(...)`. */
  upsert?: Record<string, Linhas>;
  /** Erro por (op, tabela), ex.: `{ "update:alerts": "boom" }`. */
  erros?: Record<string, string>;
};

export type QueryFake = {
  client: SupabaseClient;
  queries: RecordedQuery[];
  /** Consultas de uma tabela/operação, na ordem em que aconteceram. */
  de: (op: RecordedQuery["op"], table: string) => RecordedQuery[];
};

/** Acha o argumento de um método na cadeia registrada (ex.: `or`). */
export function argsDe(q: RecordedQuery, metodo: string): unknown[] | undefined {
  return q.calls.find((c) => c.method === metodo)?.args;
}

/** Todas as chamadas de um método na cadeia (ex.: dois `.eq()` diferentes). */
export function todasAsChamadas(q: RecordedQuery, metodo: string): RecordedCall[] {
  return q.calls.filter((c) => c.method === metodo);
}

const METODOS_CADEIA = [
  "eq",
  "neq",
  "is",
  "not",
  "lt",
  "lte",
  "gt",
  "gte",
  "or",
  "in",
  "order",
  "limit",
  "range",
] as const;

export function createQueryFake(respostas: QueryFakeRespostas = {}): QueryFake {
  const queries: RecordedQuery[] = [];

  function box(q: RecordedQuery, linhas: Linhas, erro: string | null) {
    const resultado = { data: linhas, error: erro === null ? null : { message: erro } };
    // biome-ignore lint/suspicious/noExplicitAny: fake de query builder encadeável
    const b: any = Promise.resolve(resultado);
    for (const m of METODOS_CADEIA) {
      b[m] = (...args: unknown[]) => {
        q.calls.push({ method: m, args });
        return b;
      };
    }
    // `select` depois de update/upsert: registra e mantém a mesma resposta.
    b.select = (...args: unknown[]) => {
      q.calls.push({ method: "select", args });
      return b;
    };
    b.single = () => {
      q.calls.push({ method: "single", args: [] });
      return Promise.resolve({
        data: linhas[0] ?? null,
        error: erro === null ? null : { message: erro },
      });
    };
    b.maybeSingle = b.single;
    return b;
  }

  const from = (table: string) => {
    const abrir = (op: RecordedQuery["op"], extra: Partial<RecordedQuery>) => {
      const q: RecordedQuery = { table, op, calls: [], ...extra };
      queries.push(q);
      const fonte =
        op === "select"
          ? respostas.select
          : op === "update"
            ? respostas.update
            : op === "upsert"
              ? respostas.upsert
              : undefined;
      return box(q, fonte?.[table] ?? [], respostas.erros?.[`${op}:${table}`] ?? null);
    };
    return {
      select: (...args: unknown[]) => {
        const b = abrir("select", {});
        return b.select(...args);
      },
      update: (patch: Record<string, unknown>) => abrir("update", { patch }),
      upsert: (rows: unknown[]) => abrir("upsert", { rows }),
      insert: (rows: unknown[]) => abrir("insert", { rows }),
      delete: () => abrir("delete", {}),
    };
  };

  return {
    client: { from } as unknown as SupabaseClient,
    queries,
    de: (op, table) => queries.filter((q) => q.op === op && q.table === table),
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
