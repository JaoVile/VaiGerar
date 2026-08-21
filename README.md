[![CI](https://github.com/JaoVile/VaiGerar/actions/workflows/ci.yml/badge.svg)](https://github.com/JaoVile/VaiGerar/actions/workflows/ci.yml)

# VaiGerar — deal hunter

Collects promo posts from public Telegram channels, archives them in Postgres,
and alerts you on Telegram when a product you are watching drops into your
price range.

The point is not "another deals feed". It is a **price floor with memory**:
every post is archived, so a new offer is judged against the historical median
for that product — not against whatever the channel calls a discount today.

**Stack** — Next.js 15 (App Router, API routes only) · TypeScript · Supabase
(Postgres) · Telegram Bot API · Vitest · Biome. No server to keep alive: the
whole thing runs on serverless routes driven by an external cron.

## How it works

```
Telegram channels (public t.me pages)
        │  scrape + parse (price, coupon, store)
        ▼
   Postgres (Supabase) ── 8 migrations, 3-month rolling retention
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

28 test files under `tests/`, mirroring the `lib/` layout.

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

## Status

Collector, parsing, hunts and the Telegram bot are built and tested.
Deployment (Vercel env + external cron scheduling) is manual setup, not
automated here.

## License

MIT © João Vilela