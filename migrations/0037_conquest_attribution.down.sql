ALTER TABLE users
  DROP COLUMN IF EXISTS avatar_url;

ALTER TABLE conquest_log
  DROP COLUMN IF EXISTS causing_support_id;

DROP INDEX IF EXISTS supports_conquest_log_id_idx;

ALTER TABLE supports
  DROP COLUMN IF EXISTS conquest_log_id;
