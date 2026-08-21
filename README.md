[![CI](https://github.com/JaoVile/VaiGerar/actions/workflows/ci.yml/badge.svg)](https://github.com/JaoVile/VaiGerar/actions/workflows/ci.yml)

# VaiGerar — deal hunter

**Run dashboard:** [vai-gerar.vercel.app](https://vai-gerar.vercel.app) —
password-gated, see [Run dashboard](#run-dashboard) below.

Collects promo posts from public Telegram channels, archives them in Postgres,
and alerts you on Telegram when a product you are watching drops into your
price range.

The point is not "another deals feed". It is a **price floor with memory**:
every post is archived, so a new offer is judged against the historical median
for that product — not against whatever the channel calls a discount today.

**Stack** — Next.js 15 (App Router; API routes plus the run dashboard) · TypeScript · Supabase
(Postgres) · Telegram Bot API · Vitest · Biome. No server to keep alive: the
whole thing runs on serverless routes driven by an external cron.

## How it works

```
Telegram channels (public t.me pages)
        │  scrape + parse (price, coupon, store)
        ▼
   Postgres (Supabase) ── 10 migrations, 3-month rolling retention
        │  hunts: term matching + median-as-a-ruler
        ▼
   Telegram bot ── alert when price ≤ your floor
```

Four cron routes, all `POST` and authenticated with an `x-cron-secret` header:

| Route | Frequency | Job |
|---|---|---|
| `/api/cron/tick` | 5 min | incremental collection; lights a canary if every channel returns zero |
| `/api/cron/backfill` | 10 min | one page per channel per call — deliberately slow, to not hammer `t.me` |
| `/api/cron/reprocess` | on demand | re-parses archived posts after a parser change |
| `/api/cron/purge` | scheduled | batch-deletes posts past the retention window |

`/api/telegram/webhook` receives bot commands (create hunt, list, current
price, help).

## Things worth reading

- `lib/parse/` — price, coupon and store extraction from free-form post text,
  tested against real captured HTML fixtures in `tests/fixtures/`.
- `lib/search/piso.ts` — the sanity floor: an offer only alerts if it beats the
  historical median by a real margin, which kills the "fake discount" noise.
- `lib/cron/backfill.ts` — resumable pagination that survives a broken parser
  without confusing it with end-of-archive.
- `docs/OPERATIONS.md` — the runbook: env vars, cron scheduling, migrations,
  what to do when the canary lights up.

30 test files / 476 tests under `tests/`, mirroring the `lib/` layout.

## Running it

```bash
pnpm install
cp .env.local.example .env.local   # fill in Supabase + cron secret
pnpm dev                           # http://localhost:3010
pnpm test                          # vitest
pnpm check                         # biome
```

Environment variables and where to get each one are documented in
[`docs/OPERATIONS.md`](docs/OPERATIONS.md). Migrations live in
`supabase/migrations/`, numbered and applied in order.

## Run dashboard

**Live:** [vai-gerar.vercel.app](https://vai-gerar.vercel.app)

`/` is the cron execution log: one row per run, what each channel returned,
what made it into the database, and how many alerts went out.

Before this the tick report existed in two places that both forget — the JSON
handed back to the scheduler, which nobody reads, and Vercel's `console.error`,
which expires and cannot be compared across runs. So "how many days has this
channel been returning zero?" had no answer. That is precisely the question the
tick's canary exists to raise.

Apply `supabase/migrations/0009_tick_runs.sql` and
`0010_limites_e_canais.sql` before using it, and set
`DASHBOARD_PASSWORD`. Without that variable the dashboard refuses to serve in
production rather than opening to everyone — this repository is public and the
screen shows error messages from a live system. The session is an HMAC-SHA256
signed cookie, good for 12 hours, with no server-side state.

| Question | Where it is answered |
| :-- | :-- |
| Is it collecting right now? | The "Coletor" band at the top |
| Did the scheduler die? | "Parado" outranks a green last run |
| Which channel broke, and with what error? | Expand the run's row |
| Which channel stopped bringing anything new? | "Canais — últimas 24 h" |
| Is there room for another channel? | "Disco — plano free": projected plateau, not today's size |
| Why has this hunt never fired? | "Faixas das caças": floor, target, ceiling, and the lowest price standing right now |
| Is the tick about to hit the route's 60 s ceiling? | "Limites da coleta" |
| Add or remove a channel | "Canais" — paste the `t.me` link, read the preview, confirm |

"Parado" outranking green is the point: an `ok` run from three hours ago is not
good news, it is the last thing that worked before the scheduler stopped. If
green won, the quietest failure mode in the system would read as "all fine".

Measured in production on 2026-08-21: 25 active channels, ~500 posts read and
11–15 new ones stored per run, one run every 5 minutes, 2–3 s per run.

Adding a channel runs the project's own parser against the channel's public
preview first and shows what it read: posts per day, share of posts with a
readable price, the median, and how much of the free plan the channel would
take at the plateau. The check is repeated server-side on save — the client
sends a slug, never a verdict. This is the same work the 0006 expansion did by
hand, where 6 of 24 candidates were dead and 5 were coupon channels.

Removing a channel deletes its posts in batches and only then the channel row,
so a removal cut short by the route's time limit leaves a registered channel,
never an orphan.

Run log retention is 14 days, purged alongside posts by `/api/cron/purge` —
deliberately shorter than the post archive, which has to stay searchable for
three months. A run log has answered everything it can well before that.

## Status

Collector, parsing, hunts and the Telegram bot are built and tested.
Deployment (Vercel env + external cron scheduling) is manual setup, not
automated here.

## License

MIT © João Vilela