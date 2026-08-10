-- Credit pack IAP catalog, purchase audit, optional cosmetics / battle pass (06.1 / 06.2).

CREATE TABLE credit_packs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider   TEXT NOT NULL CHECK (provider IN ('apple', 'google')),
  product_id TEXT NOT NULL,
  credits    BIGINT NOT NULL CHECK (credits > 0),
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, product_id),
  CHECK (char_length(trim(product_id)) > 0)
);

CREATE INDEX credit_packs_active_idx ON credit_packs (active) WHERE active;

CREATE TABLE iap_purchases (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users (id),
  provider                 TEXT NOT NULL CHECK (provider IN ('apple', 'google')),
  product_id               TEXT NOT NULL,
  provider_transaction_id  TEXT NOT NULL,
  credits_granted          BIGINT NOT NULL CHECK (credits_granted > 0),
  status                   TEXT NOT NULL DEFAULT 'verified'
                             CHECK (status IN ('verified')),
  verified_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_transaction_id),
  CHECK (char_length(trim(product_id)) > 0),
  CHECK (char_length(trim(provider_transaction_id)) > 0)
);

CREATE INDEX iap_purchases_user_idx ON iap_purchases (user_id, created_at DESC);

CREATE TABLE cosmetics (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL CHECK (kind IN ('tribe_banner', 'avatar_frame', 'map_pin')),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(trim(code)) > 0),
  CHECK (char_length(trim(name)) > 0)
);

CREATE TABLE battle_pass_seasons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE,
  starts_at  TIMESTAMPTZ NOT NULL,
  ends_at    TIMESTAMPTZ NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(trim(code)) > 0),
  CHECK (ends_at > starts_at)
);

CREATE TABLE battle_pass_tiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     UUID NOT NULL REFERENCES battle_pass_seasons (id) ON DELETE CASCADE,
  tier_index    INT NOT NULL CHECK (tier_index >= 1),
  xp_required   INT NOT NULL CHECK (xp_required >= 0),
  cosmetic_id   UUID REFERENCES cosmetics (id),
  credit_reward BIGINT CHECK (credit_reward IS NULL OR credit_reward > 0),
  UNIQUE (season_id, tier_index)
);

CREATE TABLE user_cosmetics (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  cosmetic_id  UUID NOT NULL REFERENCES cosmetics (id),
  source       TEXT NOT NULL CHECK (source IN ('battle_pass', 'purchase')),
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, cosmetic_id)
);

CREATE INDEX user_cosmetics_user_idx ON user_cosmetics (user_id);

CREATE TABLE user_battle_pass (
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  season_id   UUID NOT NULL REFERENCES battle_pass_seasons (id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  premium     BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, season_id)
);

CREATE TABLE user_battle_pass_claims (
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  season_id   UUID NOT NULL REFERENCES battle_pass_seasons (id) ON DELETE CASCADE,
  tier_id     UUID NOT NULL REFERENCES battle_pass_tiers (id) ON DELETE CASCADE,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tier_id)
);

CREATE INDEX user_battle_pass_claims_season_idx
  ON user_battle_pass_claims (user_id, season_id);

-- Dev/test seed packs (same product_id on both stores).
INSERT INTO credit_packs (provider, product_id, credits, active) VALUES
  ('apple',  'credits_100',  100,  true),
  ('apple',  'credits_500',  500,  true),
  ('apple',  'credits_1200', 1200, true),
  ('google', 'credits_100',  100,  true),
  ('google', 'credits_500',  500,  true),
  ('google', 'credits_1200', 1200, true);

INSERT INTO cosmetics (code, kind, name) VALUES
  ('banner_starter', 'tribe_banner', 'Starter Banner'),
  ('banner_veteran', 'tribe_banner', 'Veteran Banner');

INSERT INTO battle_pass_seasons (code, starts_at, ends_at, active)
VALUES (
  'season_1',
  TIMESTAMPTZ '2020-01-01 00:00:00+00',
  TIMESTAMPTZ '2099-01-01 00:00:00+00',
  true
);

INSERT INTO battle_pass_tiers (season_id, tier_index, xp_required, cosmetic_id, credit_reward)
SELECT s.id, 1, 0, c.id, NULL
FROM battle_pass_seasons s
CROSS JOIN cosmetics c
WHERE s.code = 'season_1' AND c.code = 'banner_starter';

INSERT INTO battle_pass_tiers (season_id, tier_index, xp_required, cosmetic_id, credit_reward)
SELECT s.id, 2, 100, c.id, 50
FROM battle_pass_seasons s
CROSS JOIN cosmetics c
WHERE s.code = 'season_1' AND c.code = 'banner_veteran';
