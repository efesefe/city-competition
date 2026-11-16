-- CC-62: capture beat completes after N confirms on the locked tutorial city
-- even when ownership does not flip to the player's tribe.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tutorial_capture_confirms INTEGER NOT NULL DEFAULT 0;
