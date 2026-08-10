-- Push tokens, feed reactions, referral fraud gating, and shareable achievements.

CREATE TABLE device_push_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform   TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  token      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token),
  UNIQUE (user_id, platform, token)
);

CREATE INDEX device_push_tokens_user_idx ON device_push_tokens (user_id);

CREATE TABLE event_reactions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES activity_events (id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(trim(emoji)) > 0),
  UNIQUE (event_id, user_id)
);

CREATE INDEX event_reactions_event_idx ON event_reactions (event_id);

CREATE TABLE referral_codes (
  user_id    UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  code       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(trim(code)) >= 4)
);

CREATE TABLE referral_redemptions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id        UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  referee_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status             TEXT NOT NULL CHECK (status IN ('granted', 'flagged')),
  device_fingerprint TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (referrer_id <> referee_id),
  UNIQUE (referee_id)
);

CREATE INDEX referral_redemptions_fingerprint_idx ON referral_redemptions (device_fingerprint);
CREATE INDEX referral_redemptions_referrer_idx ON referral_redemptions (referrer_id);

CREATE TABLE flagged_users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason       TEXT NOT NULL,
  context_type TEXT,
  context_id   UUID,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(trim(reason)) > 0)
);

CREATE INDEX flagged_users_status_idx ON flagged_users (status, created_at DESC);
CREATE INDEX flagged_users_user_idx ON flagged_users (user_id);

CREATE TABLE user_device_fingerprints (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint)
);

CREATE INDEX user_device_fingerprints_fp_idx ON user_device_fingerprints (fingerprint);

CREATE TYPE achievement_kind AS ENUM (
  'first_support',
  'derby_mvp',
  'top_n_province_supporter',
  'top_n_tribe_supporter',
  'season_badge',
  'streak_n'
);

CREATE TABLE achievements (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id  TEXT NOT NULL UNIQUE,
  user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       achievement_kind NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(trim(public_id)) >= 8),
  -- Idempotency: one milestone row per user/kind/payload fingerprint.
  UNIQUE (user_id, kind, payload)
);

CREATE INDEX achievements_user_idx ON achievements (user_id, created_at DESC);
