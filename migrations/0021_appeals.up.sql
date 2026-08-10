-- Player appeals for banned / shadow_banned / flagged accounts (08.5).
CREATE TABLE appeals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users (id),
  reason     TEXT NOT NULL CHECK (char_length(trim(reason)) > 0),
  status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX appeals_status_idx ON appeals (status, created_at DESC);
CREATE UNIQUE INDEX appeals_one_pending_per_user ON appeals (user_id) WHERE status = 'pending';
