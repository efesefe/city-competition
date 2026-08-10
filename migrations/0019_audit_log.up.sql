CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID NOT NULL REFERENCES users (id),
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   UUID NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_actor_created_idx ON audit_log (actor_id, created_at DESC);
CREATE INDEX audit_log_target_idx ON audit_log (target_type, target_id);
