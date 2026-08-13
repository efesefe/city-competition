-- Durable city-ownership flip log. One row is inserted inside the same
-- transaction that changes leadership in tribe_province_scores (see
-- backend/internal/support/spend.go). A flip that is not logged is a
-- data-integrity bug, not an acceptable edge case.
--
-- Unread state is a single cursor on users rather than a per-row reads
-- table: GET /v1/conquest-log/unread-count is COUNT of rows after the
-- marker, cheap enough to poll on every app foreground.

CREATE TABLE conquest_log (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  il_code                    TEXT NOT NULL REFERENCES admin_boundaries (il_code),
  city_name                  TEXT NOT NULL,
  previous_tribe_id          UUID REFERENCES tribes (id),
  new_tribe_id               UUID NOT NULL REFERENCES tribes (id),
  winning_committed_credits  NUMERIC NOT NULL,
  occurred_at                TIMESTAMPTZ NOT NULL,
  was_derbi_bonus            BOOLEAN NOT NULL,
  CONSTRAINT conquest_log_city_name_nonempty
    CHECK (char_length(trim(city_name)) > 0),
  CONSTRAINT conquest_log_winning_credits_positive
    CHECK (winning_committed_credits > 0),
  CONSTRAINT conquest_log_tribe_changed
    CHECK (previous_tribe_id IS DISTINCT FROM new_tribe_id)
);

CREATE INDEX conquest_log_occurred_id_idx
  ON conquest_log (occurred_at DESC, id DESC);

ALTER TABLE users
  ADD COLUMN last_read_conquest_log_id UUID REFERENCES conquest_log (id) ON DELETE SET NULL;
