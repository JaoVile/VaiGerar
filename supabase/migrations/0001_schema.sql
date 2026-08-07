create table channels (
  slug              text primary key,
  title             text,
  kind              text not null check (kind in ('tech', 'china')),
  is_active         boolean not null default true,
  last_post_id      bigint not null default 0,
  backfill_cursor   bigint,
  backfill_complete boolean not null default false,
  created_at        timestamptz not null default now()
);

create table posts (
  id             bigserial primary key,
  channel_slug   text not null references channels(slug),
  post_id        bigint not null,
  posted_at      timestamptz not null,
  text           text not null,
  url            text not null,
  price_cents    integer,
  prices_cents   integer[] not null default '{}',
  store          text,
  product_url    text,
  search_vector  tsvector generated always as (to_tsvector('portuguese', text)) stored,
  created_at     timestamptz not null default now(),
  unique (channel_slug, post_id)
);
create index posts_search_idx on posts using gin(search_vector);
create index posts_posted_idx on posts (posted_at desc);
create index posts_price_idx  on posts (price_cents) where price_cents is not null;

create table hunts (
  id               uuid primary key default gen_random_uuid(),
  chat_id          bigint not null,
  bot_key          text not null default 'ofertas',
  label            text not null,
  query            text not null,
  terms_any        text[] not null,
  terms_all        text[] not null default '{}',
  terms_none       text[] not null default '{}',
  target_cents     integer not null,
  tolerance_pct    numeric(5,2) not null default 5.0,
  price_min_cents  integer generated always as
                     (round(target_cents * (100 - tolerance_pct) / 100)::integer) stored,
  price_max_cents  integer generated always as
                     (round(target_cents * (100 + tolerance_pct) / 100)::integer) stored,
  channels         text[] not null default '{}',
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  last_alert_at    timestamptz
);

create table alerts (
  id           bigserial primary key,
  hunt_id      uuid not null references hunts(id) on delete cascade,
  post_row_id  bigint not null references posts(id) on delete cascade,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  attempts     integer not null default 0,
  unique (hunt_id, post_row_id)
);

create table user_settings (
  chat_id            bigint primary key,
  tolerance_default  numeric(5,2) not null default 5.0,
  digest_enabled     boolean not null default true,
  digest_hour        smallint not null default 20,
  digest_sent_on     date,
  search_months      smallint not null default 6
);

create table bot_sessions (
  chat_id     bigint primary key,
  flow        text not null,
  step        text not null,
  data        jsonb not null default '{}',
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
