-- XP, rank tiers, and quest engine (05.7 / 05.8).

CREATE TABLE rank_tiers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  min_xp     INT NOT NULL CHECK (min_xp >= 0),
  badge_name TEXT NOT NULL,
  sort_order INT NOT NULL,
  UNIQUE (min_xp),
  UNIQUE (sort_order),
  CHECK (char_length(trim(badge_name)) > 0)
);

CREATE TABLE quest_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  period     TEXT NOT NULL CHECK (period IN ('daily', 'weekly')),
  criteria   JSONB NOT NULL,
  xp_reward  INT NOT NULL DEFAULT 0 CHECK (xp_reward >= 0),
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(trim(code)) > 0),
  CHECK (char_length(trim(title)) > 0),
  CHECK (jsonb_typeof(criteria) = 'object')
);

CREATE INDEX quest_templates_active_idx ON quest_templates (active) WHERE active;

CREATE TABLE user_xp (
  user_id    UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  total_xp   INT NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_quest_progress (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  template_id   UUID NOT NULL REFERENCES quest_templates (id) ON DELETE CASCADE,
  period_key    TEXT NOT NULL,
  progress      INT NOT NULL DEFAULT 0 CHECK (progress >= 0),
  progress_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'completed')),
  completed_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, template_id, period_key),
  CHECK (char_length(trim(period_key)) > 0)
);

CREATE INDEX user_quest_progress_user_idx
  ON user_quest_progress (user_id, status);

INSERT INTO rank_tiers (min_xp, badge_name, sort_order) VALUES
  (0, 'Çaylak', 1),
  (100, 'Destekçi', 2),
  (500, 'Veteran', 3),
  (2000, 'Efsane', 4);

INSERT INTO quest_templates (code, title, period, criteria, xp_reward, active) VALUES
  (
    'daily_support_3_provinces',
    '3 il destekle',
    'daily',
    '{"type":"support_count","target":3,"scope":"province"}'::jsonb,
    50,
    true
  ),
  (
    'daily_derby_support',
    'Derby şehrinde destek ver',
    'daily',
    '{"type":"derby_support","target":1}'::jsonb,
    40,
    true
  ),
  (
    'weekly_streak_5',
    '5 gün streak',
    'weekly',
    '{"type":"streak","target":5}'::jsonb,
    100,
    true
  );
