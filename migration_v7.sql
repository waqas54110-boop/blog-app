-- migration_v7.sql
-- Prediction League: cricket matches par predictions + points.
-- Neon SQL Editor mein ek baar run karein. Dobara run karna bhi safe hai.
-- Deploy se PEHLE run karein.

-- 1) Matches (sirf admin banata hai)
CREATE TABLE IF NOT EXISTS pred_matches (
  id         SERIAL PRIMARY KEY,
  team_a     VARCHAR(60)  NOT NULL,
  team_b     VARCHAR(60)  NOT NULL,
  title      VARCHAR(120),                         -- e.g. "Asia Cup Final"
  starts_at  TIMESTAMPTZ  NOT NULL,                -- iske baad predictions band
  winner     VARCHAR(4),                           -- NULL (abhi nahi hua) | 'a' | 'b' | 'draw'
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT pred_winner_chk CHECK (winner IS NULL OR winner IN ('a','b','draw'))
);
CREATE INDEX IF NOT EXISTS pred_matches_start_idx ON pred_matches (starts_at DESC);

-- 2) Har user ki prediction (ek match par ek hi)
CREATE TABLE IF NOT EXISTS predictions (
  match_id   INTEGER NOT NULL REFERENCES pred_matches(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pick       VARCHAR(4) NOT NULL,                  -- 'a' | 'b' | 'draw'
  points     INTEGER NOT NULL DEFAULT 0,           -- settle par 10 (sahi) ya 0
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id),
  CONSTRAINT pred_pick_chk CHECK (pick IN ('a','b','draw'))
);
CREATE INDEX IF NOT EXISTS predictions_user_idx ON predictions (user_id);
