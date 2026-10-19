CREATE TABLE IF NOT EXISTS platform_administrator (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
