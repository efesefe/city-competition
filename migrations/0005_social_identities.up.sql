-- Linked OAuth identities (Google / Apple). Never trust client-supplied profile data;
-- provider_user_id comes from verified ID tokens only.

CREATE TABLE social_identities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider         TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  provider_user_id TEXT NOT NULL,
  email            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX social_identities_user_id_idx ON social_identities (user_id);
