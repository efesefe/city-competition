-- Account moderation status: active (default), banned (auth reject), shadow_banned (inert support).
ALTER TABLE users
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CONSTRAINT users_status_check CHECK (status IN ('active', 'banned', 'shadow_banned'));

CREATE INDEX users_status_idx ON users (status) WHERE status <> 'active';
