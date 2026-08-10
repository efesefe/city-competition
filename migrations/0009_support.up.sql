-- Province support spends and per-tribe aggregate scores.

CREATE TABLE supports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users (id),
  tribe_id          UUID NOT NULL REFERENCES tribes (id),
  il_code           TEXT NOT NULL REFERENCES admin_boundaries (il_code),
  credits_spent     BIGINT NOT NULL CHECK (credits_spent > 0),
  multiplier        NUMERIC NOT NULL DEFAULT 1 CHECK (multiplier > 0),
  effective_support NUMERIC NOT NULL CHECK (effective_support > 0),
  derby_id          UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX supports_user_created_idx ON supports (user_id, created_at DESC);
CREATE INDEX supports_il_created_idx ON supports (il_code, created_at DESC);
CREATE INDEX supports_tribe_il_idx ON supports (tribe_id, il_code);

CREATE TABLE tribe_province_scores (
  tribe_id              UUID NOT NULL REFERENCES tribes (id),
  il_code               TEXT NOT NULL REFERENCES admin_boundaries (il_code),
  effective_support_sum NUMERIC NOT NULL DEFAULT 0 CHECK (effective_support_sum >= 0),
  PRIMARY KEY (tribe_id, il_code)
);
