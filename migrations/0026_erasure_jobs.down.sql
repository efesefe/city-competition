DROP TABLE IF EXISTS analytics_deletion_events;
DROP TABLE IF EXISTS erasure_jobs;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users
  ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'banned', 'shadow_banned'));
