DROP INDEX IF EXISTS users_email_lower_key;

ALTER TABLE users
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS restricted_mode,
  DROP COLUMN IF EXISTS birth_date;

-- Restore NOT NULL on phone (fails if null phones exist).
ALTER TABLE users ALTER COLUMN phone SET NOT NULL;
