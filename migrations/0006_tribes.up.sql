-- Fixed admin-managed parody tribes. Seeded from JSON at API boot (not SQL).

CREATE TABLE tribes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 TEXT NOT NULL UNIQUE,
  display_name         TEXT NOT NULL,
  short_name           TEXT NOT NULL,
  primary_color        TEXT NOT NULL,
  secondary_color      TEXT NOT NULL,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  created_by_admin_id  UUID REFERENCES users (id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tribes_display_name_nonempty CHECK (char_length(trim(display_name)) > 0),
  CONSTRAINT tribes_short_name_nonempty CHECK (char_length(trim(short_name)) > 0),
  CONSTRAINT tribes_slug_nonempty CHECK (char_length(trim(slug)) > 0),
  CONSTRAINT tribes_primary_color_hex CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT tribes_secondary_color_hex CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$')
);

ALTER TABLE users
  ADD COLUMN tribe_id UUID REFERENCES tribes (id),
  ADD COLUMN tribe_switched_at TIMESTAMPTZ,
  ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX users_tribe_id_idx ON users (tribe_id);
