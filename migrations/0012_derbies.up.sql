-- Match-day derby events: host tribe vs guest tribe in one il.

CREATE TABLE derbies (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_tribe_id          UUID NOT NULL REFERENCES tribes (id),
  guest_tribe_id         UUID NOT NULL REFERENCES tribes (id),
  il_code                TEXT NOT NULL REFERENCES admin_boundaries (il_code),
  starts_at              TIMESTAMPTZ NOT NULL,
  ends_at                TIMESTAMPTZ NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'active', 'resolved')),
  host_effective_total   NUMERIC NOT NULL DEFAULT 0 CHECK (host_effective_total >= 0),
  guest_effective_total  NUMERIC NOT NULL DEFAULT 0 CHECK (guest_effective_total >= 0),
  created_by_admin_id    UUID NOT NULL REFERENCES users (id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (host_tribe_id <> guest_tribe_id),
  CHECK (ends_at > starts_at)
);

CREATE INDEX derbies_status_idx ON derbies (status);
CREATE INDEX derbies_status_starts_at_idx ON derbies (status, starts_at);
CREATE INDEX derbies_status_ends_at_idx ON derbies (status, ends_at);
CREATE INDEX derbies_il_code_idx ON derbies (il_code);

ALTER TABLE supports
  ADD CONSTRAINT supports_derby_id_fkey
  FOREIGN KEY (derby_id) REFERENCES derbies (id);
