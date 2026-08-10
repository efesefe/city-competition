ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users
  ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'banned', 'shadow_banned', 'erased'));

CREATE TABLE IF NOT EXISTS erasure_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'partial_failure', 'completed', 'failed')),
    request_id TEXT NOT NULL DEFAULT '',
    completed_steps TEXT[] NOT NULL DEFAULT '{}',
    last_error TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS erasure_jobs_status_requested_idx
    ON erasure_jobs (status, requested_at);

CREATE TABLE IF NOT EXISTS analytics_deletion_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    job_id UUID NOT NULL REFERENCES erasure_jobs(id),
    request_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS analytics_deletion_events_unconsumed_idx
    ON analytics_deletion_events (created_at)
    WHERE consumed_at IS NULL;
