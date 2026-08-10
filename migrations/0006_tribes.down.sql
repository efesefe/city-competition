DROP INDEX IF EXISTS users_tribe_id_idx;

ALTER TABLE users
  DROP COLUMN IF EXISTS is_admin,
  DROP COLUMN IF EXISTS tribe_switched_at,
  DROP COLUMN IF EXISTS tribe_id;

DROP TABLE IF EXISTS tribes;
