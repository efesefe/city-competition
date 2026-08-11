-- In-app notification inbox + allow web push token platform.

CREATE TABLE user_notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(trim(type)) > 0),
  CHECK (char_length(trim(title)) > 0),
  CHECK (char_length(trim(body)) > 0)
);

CREATE INDEX user_notifications_user_created_idx
  ON user_notifications (user_id, created_at DESC);

CREATE INDEX user_notifications_user_unread_idx
  ON user_notifications (user_id)
  WHERE read_at IS NULL;

ALTER TABLE device_push_tokens
  DROP CONSTRAINT IF EXISTS device_push_tokens_platform_check;

ALTER TABLE device_push_tokens
  ADD CONSTRAINT device_push_tokens_platform_check
  CHECK (platform IN ('ios', 'android', 'web'));
