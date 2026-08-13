-- Capture attribution: link the supports that made up a flip, record which
-- single spend crossed the threshold, and store uploaded avatar URLs.
--
-- Windowing (enforced in backend/internal/conquest/attribution.go, not a
-- constraint): only the winning tribe's supports on this city since they last
-- lost it (or all of them on a first capture) receive conquest_log_id.

ALTER TABLE supports
  ADD COLUMN conquest_log_id UUID REFERENCES conquest_log (id) ON DELETE SET NULL;

CREATE INDEX supports_conquest_log_id_idx
  ON supports (conquest_log_id)
  WHERE conquest_log_id IS NOT NULL;

ALTER TABLE conquest_log
  ADD COLUMN causing_support_id UUID REFERENCES supports (id) ON DELETE SET NULL;

ALTER TABLE users
  ADD COLUMN avatar_url TEXT;
