-- Age gate: birth date, restricted mode, optional email; phone nullable for social-first accounts.

ALTER TABLE users
  ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE users
  ADD COLUMN birth_date DATE NOT NULL DEFAULT DATE '2000-01-01',
  ADD COLUMN restricted_mode BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN email TEXT;

-- Drop the default after backfill for greenfield/new inserts that must supply birth_date.
ALTER TABLE users ALTER COLUMN birth_date DROP DEFAULT;

CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email)) WHERE email IS NOT NULL;
