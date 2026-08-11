alter table alerts add column if not exists claimed_at timestamptz;
create index if not exists alerts_pendentes_idx
  on alerts (sent_at, claimed_at) where sent_at is null;
