ALTER TABLE users
  DROP COLUMN IF EXISTS last_read_conquest_log_id;

DROP TABLE IF EXISTS conquest_log;
