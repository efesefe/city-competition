-- CC-19: map Supabase Auth users onto local game User rows.
ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_user_id TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS users_supabase_user_id_idx ON users (supabase_user_id);
