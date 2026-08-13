-- Indexes for per-city flip aggregations and nationwide activity-feed merge.
-- Flip counts and holding streaks are derived from conquest_log at read time
-- (optionally Redis-cached); this migration does not add a mutable counter.

CREATE INDEX conquest_log_il_occurred_idx
  ON conquest_log (il_code, occurred_at DESC, id DESC);

CREATE INDEX supports_created_id_idx
  ON supports (created_at DESC, id DESC);
