-- Daily support streak state (calendar dates computed in Europe/Istanbul by the app).

CREATE TABLE user_support_streaks (
  user_id           UUID PRIMARY KEY REFERENCES users (id),
  current_streak    INT NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  longest_streak    INT NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
  last_support_date DATE
);
