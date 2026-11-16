-- Attack alert pipeline (CC-57): in-app inbox + device tokens for push fan-out.
-- Coalesce windows live in Redis (5 min); this table is the durable in-app feed.

CREATE TABLE IF NOT EXISTS user_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
  ON user_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_notifications_user_unread_idx
  ON user_notifications (user_id)
  WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS device_push_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'unknown',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS device_push_tokens_user_idx
  ON device_push_tokens (user_id);

-- Speeds last-24h interest lookup on rival spend.
CREATE INDEX IF NOT EXISTS support_ledger_city_created_idx
  ON support_ledger (city_plate, created_at DESC);
