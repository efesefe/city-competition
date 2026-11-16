-- Static share cards (CC-59): logged-in support + accomplishment templates only.
-- Guest generic map share is explicitly out of v1.

CREATE TABLE IF NOT EXISTS share_cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('support', 'accomplishment')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS share_cards_user_created_idx
  ON share_cards (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS share_cards_kind_created_idx
  ON share_cards (kind, created_at DESC);
