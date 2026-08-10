-- User relationship state (friends, blocks, mutes) and abuse reports.

CREATE TYPE user_relation_type AS ENUM (
  'friend_request',
  'friend',
  'blocked',
  'muted'
);

CREATE TABLE user_relations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_user_id   UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type         user_relation_type NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_user_id <> to_user_id),
  UNIQUE (from_user_id, to_user_id, type)
);

CREATE INDEX user_relations_to_type_idx ON user_relations (to_user_id, type);
CREATE INDEX user_relations_from_type_idx ON user_relations (from_user_id, type);

CREATE TABLE user_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reported_id  UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason       TEXT NOT NULL,
  context_type TEXT,
  context_id   UUID,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reporter_id <> reported_id)
);

CREATE INDEX user_reports_status_idx ON user_reports (status, created_at DESC);
