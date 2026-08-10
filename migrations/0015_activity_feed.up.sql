-- Structured activity feed events (render localized strings at read-time).

CREATE TABLE activity_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT NOT NULL,
  actor_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  place_name  TEXT NOT NULL,
  place_type  TEXT NOT NULL,
  tribe_id    UUID REFERENCES tribes (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(trim(place_name)) > 0),
  CHECK (char_length(trim(event_type)) > 0),
  CHECK (char_length(trim(place_type)) > 0)
);

CREATE INDEX activity_events_created_idx ON activity_events (created_at DESC);
CREATE INDEX activity_events_actor_created_idx ON activity_events (actor_id, created_at DESC);
CREATE INDEX activity_events_tribe_created_idx ON activity_events (tribe_id, created_at DESC);
