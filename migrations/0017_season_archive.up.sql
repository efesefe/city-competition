-- Seasonal snapshots of supporter leaderboard ZSETs (05.6).

CREATE TABLE season_archive (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id    TEXT NOT NULL,
  redis_key    TEXT NOT NULL,
  scope_type   TEXT NOT NULL
    CHECK (scope_type IN ('global', 'tribe', 'province', 'derby')),
  entries      JSONB NOT NULL,
  member_count INT NOT NULL CHECK (member_count >= 0),
  archived_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (season_id, redis_key)
);

CREATE INDEX season_archive_season_id_idx ON season_archive (season_id);
