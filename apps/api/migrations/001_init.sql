-- Season 0 slice schema — cities, teams/aliases, users/sessions, energy, support ledger.
-- Handoff (Realtime “Persist ledger and live flips”): support_ledger is append-only with
-- UNIQUE(idempotency_key); city_support is the materialized cumulative tally (persists across
-- ownership flips). Spend path already writes ledger + tally + owner flip in one transaction.
-- Next leaf should keep that atomicity, add boost snapshot columns if needed, and fan-out via Redis.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams (
  internal_id TEXT PRIMARY KEY,
  public_alias TEXT NOT NULL UNIQUE,
  primary_color TEXT NOT NULL,
  secondary_color TEXT NOT NULL,
  big4 BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS cities (
  plate TEXT PRIMARY KEY,
  name_tr TEXT NOT NULL,
  owner_team_id TEXT REFERENCES teams(internal_id)
);

CREATE TABLE IF NOT EXISTS city_support (
  city_plate TEXT NOT NULL REFERENCES cities(plate),
  team_id TEXT NOT NULL REFERENCES teams(internal_id),
  support DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (city_plate, team_id)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  phone_e164 TEXT UNIQUE,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  tribe_id TEXT REFERENCES teams(internal_id),
  tribe_switched_at TEXT,
  free_energy DOUBLE PRECISION NOT NULL DEFAULT 0,
  paid_energy DOUBLE PRECISION NOT NULL DEFAULT 0,
  sub_energy DOUBLE PRECISION NOT NULL DEFAULT 0,
  free_grant_date TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_codes (
  phone_e164 TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  city_plate TEXT NOT NULL REFERENCES cities(plate),
  team_id TEXT NOT NULL REFERENCES teams(internal_id),
  energy_spent DOUBLE PRECISION NOT NULL,
  support_credited DOUBLE PRECISION NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS support_ledger_city_idx ON support_ledger (city_plate);
CREATE INDEX IF NOT EXISTS support_ledger_user_idx ON support_ledger (user_id);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS tunables (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
