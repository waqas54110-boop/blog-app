-- migration_v38.sql
-- V38: Creator Showcase + Trend Radar.
-- Neon SQL Editor mein ek baar run karein. Dobara run karna safe hai. Deploy se PEHLE run karein.

-- ============ CREATOR SHOWCASE ============
CREATE TABLE IF NOT EXISTS creator_posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform VARCHAR(10) NOT NULL CHECK (platform IN ('youtube', 'tiktok')),
  kind VARCHAR(10) NOT NULL DEFAULT 'channel' CHECK (kind IN ('channel', 'video')),
  url VARCHAR(300) NOT NULL,                 -- cleaned, https only, allow-listed hosts only
  yt_video_id VARCHAR(20),                   -- YouTube video ho to embed ke liye
  title VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  niche VARCHAR(30) NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,         -- "Visit / Subscribe" button ke clicks (koi points nahi)
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_posts_created_idx ON creator_posts (created_at DESC);
CREATE INDEX IF NOT EXISTS creator_posts_user_idx ON creator_posts (user_id);

CREATE TABLE IF NOT EXISTS creator_likes (
  post_id INTEGER NOT NULL REFERENCES creator_posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- kind: 'comment' (aam) ya 'feedback' (creator ke liye sachi raye: kya acha laga / kya behtar ho sakta hai)
CREATE TABLE IF NOT EXISTS creator_comments (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES creator_posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(10) NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'feedback')),
  body TEXT NOT NULL,
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_comments_post_idx ON creator_comments (post_id, created_at);

-- Creator of the Week: ek user ek hafte mein sirf EK vote (week_start = Monday, site ke timezone mein)
CREATE TABLE IF NOT EXISTS creator_votes (
  week_start DATE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES creator_posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, user_id)
);
CREATE INDEX IF NOT EXISTS creator_votes_post_idx ON creator_votes (post_id, week_start);

-- ============ TREND RADAR ============
-- Reports ka cache (YouTube / Google Trends / AI), taake API quota aur AI kharcha bacha rahe
CREATE TABLE IF NOT EXISTS trend_cache (
  cache_key VARCHAR(120) PRIMARY KEY,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
