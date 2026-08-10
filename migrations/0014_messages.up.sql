-- Direct messages and tribe chat messages (write-then-broadcast; flagged withheld).

CREATE TABLE messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         TEXT NOT NULL CHECK (kind IN ('dm', 'tribe')),
  sender_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES users (id) ON DELETE CASCADE,
  tribe_id     UUID REFERENCES tribes (id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  flagged      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'dm' AND recipient_id IS NOT NULL AND tribe_id IS NULL)
    OR (kind = 'tribe' AND tribe_id IS NOT NULL AND recipient_id IS NULL)
  ),
  CHECK (char_length(trim(body)) > 0),
  CHECK (sender_id <> recipient_id OR recipient_id IS NULL)
);

CREATE INDEX messages_dm_recipient_created_idx
  ON messages (recipient_id, created_at DESC)
  WHERE kind = 'dm';

CREATE INDEX messages_dm_sender_created_idx
  ON messages (sender_id, created_at DESC)
  WHERE kind = 'dm';

CREATE INDEX messages_tribe_created_idx
  ON messages (tribe_id, created_at DESC)
  WHERE kind = 'tribe';

CREATE INDEX messages_flagged_idx
  ON messages (created_at DESC)
  WHERE flagged = true;
