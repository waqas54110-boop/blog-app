-- migration_v3.sql
-- Naye features: scheduled/draft posts, full-text search, analytics (visits),
-- comment replies, notifications, newsletter unsubscribe.
-- Neon SQL Editor mein ek baar run karein. Dobara run karna bhi safe hai.

-- 0) reactions table (code use karta tha, lekin schema.sql mein nahi thi)
CREATE TABLE IF NOT EXISTS reactions (
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      VARCHAR(10) NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- 1) Draft + scheduled posts, aur newsletter ka flag
-- Purani posts publish rahengi, aur un par newsletter dobara NAHI jayegi.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'posts' AND column_name = 'publish_at') THEN
    ALTER TABLE posts ADD COLUMN publish_at TIMESTAMPTZ;
    UPDATE posts SET publish_at = created_at AT TIME ZONE 'UTC';
    ALTER TABLE posts ALTER COLUMN publish_at SET DEFAULT now();
    ALTER TABLE posts ALTER COLUMN publish_at SET NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'posts' AND column_name = 'newsletter_sent') THEN
    ALTER TABLE posts ADD COLUMN newsletter_sent BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE posts ALTER COLUMN newsletter_sent SET DEFAULT FALSE;
  END IF;
END $$;

ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS posts_publish_idx ON posts (is_draft, publish_at DESC);

-- 2) Full-text search ('simple' config: English + Roman Urdu dono ke liye theek)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(excerpt, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(content, '')), 'C')
  ) STORED;
CREATE INDEX IF NOT EXISTS posts_search_idx ON posts USING GIN (search_vector);

-- 3) Analytics: har visit ka source (whatsapp / facebook / google / direct ...)
CREATE TABLE IF NOT EXISTS post_visits (
  id         BIGSERIAL PRIMARY KEY,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  source     VARCHAR(40) NOT NULL DEFAULT 'direct',
  medium     VARCHAR(40),
  referrer   VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS post_visits_created_idx ON post_visits (created_at);
CREATE INDEX IF NOT EXISTS post_visits_post_idx ON post_visits (post_id);

-- 4) Comment replies
ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS comments_parent_idx ON comments (parent_id);

-- 5) In-app notifications
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message    VARCHAR(300) NOT NULL,
  link       VARCHAR(300),
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, is_read, created_at DESC);

-- 6) Newsletter unsubscribe token
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT;
UPDATE subscribers SET unsubscribe_token = md5(random()::text || id::text || clock_timestamp()::text)
  WHERE unsubscribe_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_token_idx ON subscribers (unsubscribe_token);
