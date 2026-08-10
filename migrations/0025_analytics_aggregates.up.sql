-- Anonymized daily funnel + cohort rollups for admin analytics dashboards (10.1, 10.3).
-- Dashboard queries read these tables only — never raw user_id / PII.

CREATE TABLE analytics_funnel_daily (
  day            DATE PRIMARY KEY,
  installs       INT NOT NULL DEFAULT 0 CHECK (installs >= 0),
  consented      INT NOT NULL DEFAULT 0 CHECK (consented >= 0),
  joined_tribe   INT NOT NULL DEFAULT 0 CHECK (joined_tribe >= 0),
  first_support  INT NOT NULL DEFAULT 0 CHECK (first_support >= 0),
  retained_d7    INT NOT NULL DEFAULT 0 CHECK (retained_d7 >= 0),
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (consented <= installs),
  CHECK (joined_tribe <= installs),
  CHECK (first_support <= installs),
  CHECK (retained_d7 <= installs)
);

CREATE TABLE analytics_cohort_daily (
  cohort_day    DATE PRIMARY KEY,
  cohort_size   INT NOT NULL DEFAULT 0 CHECK (cohort_size >= 0),
  retained_d1   INT NOT NULL DEFAULT 0 CHECK (retained_d1 >= 0),
  retained_d7   INT NOT NULL DEFAULT 0 CHECK (retained_d7 >= 0),
  retained_d30  INT NOT NULL DEFAULT 0 CHECK (retained_d30 >= 0),
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (retained_d1 <= cohort_size),
  CHECK (retained_d7 <= cohort_size),
  CHECK (retained_d30 <= cohort_size)
);
