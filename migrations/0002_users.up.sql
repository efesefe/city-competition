-- Users table with Turkish ICU collation for username uniqueness and sort order.
CREATE COLLATION IF NOT EXISTS "tr-TR-x-icu" (
  provider = icu,
  locale = 'tr-TR',
  deterministic = false
);

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT NOT NULL UNIQUE,
  username   TEXT NOT NULL COLLATE "tr-TR-x-icu",
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_username_len CHECK (char_length(username) BETWEEN 3 AND 24)
);

CREATE UNIQUE INDEX users_username_key ON users (username);
