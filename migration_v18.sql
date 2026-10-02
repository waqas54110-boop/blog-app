-- migration_v18.sql
-- V18: Community Feed (Facebook jaisa). Har login user photo + text post kar sakta hai, like / comment kar sakta hai.
-- Blog ke asli articles ab bhi sirf owner likhta hai. Ye alag "feed" hai.
-- Neon SQL Editor mein ek baar run karein. Dobara run karna safe hai. Deploy se PEHLE run karein.
-- (migration_v4.sql aur migration_v13.sql pehle chal chuki hon: images aur reports tables chahiye.)

-- 1) FEED POSTS (text aur/ya ek photo; photo images table se, Cloudinary ya database)
CREATE TABLE IF NOT EXISTS feed_posts (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       VARCHAR(2000) NOT NULL DEFAULT '',
  image_id   INTEGER REFERENCES images(id) ON DELETE SET NULL,
  is_hidden  BOOLEAN NOT NULL DEFAULT false,   -- spam filter / bahut reports par: sirf owner + admin ko dikhta hai
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feed_posts_user_idx ON feed_posts (user_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS feed_posts_image_uq ON feed_posts (image_id) WHERE image_id IS NOT NULL;

-- 2) LIKES (ek user ek post ko ek hi baar)
CREATE TABLE IF NOT EXISTS feed_likes (
  post_id    INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- 3) COMMENTS
CREATE TABLE IF NOT EXISTS feed_comments (
  id         SERIAL PRIMARY KEY,
  post_id    INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       VARCHAR(1000) NOT NULL,
  is_hidden  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feed_comments_post_idx ON feed_comments (post_id, id);

-- 4) REPORTS: ab feed post aur feed comment bhi report ho sakte hain
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_type_chk;
ALTER TABLE reports ADD CONSTRAINT reports_type_chk
  CHECK (target_type IN ('comment', 'poll_comment', 'poll', 'user', 'message', 'feed_post', 'feed_comment'));
