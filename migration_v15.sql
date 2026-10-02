-- migration_v15.sql
-- V15: Block user, Report user / message, Private messages (sirf friends ke darmiyan), Profile photo (avatar).
-- Neon SQL Editor mein ek baar run karein. Dobara run karna safe hai. Deploy se PEHLE run karein.
-- (migration_v13.sql aur migration_v14.sql pehle chal chuki hon.)

-- 1) BLOCK: blocker ne blocked ko block kiya
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON user_blocks (blocked_id);

-- 2) PRIVATE MESSAGES
CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        VARCHAR(1000) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ,
  CONSTRAINT messages_not_self CHECK (sender_id <> receiver_id)
);
CREATE INDEX IF NOT EXISTS messages_pair_idx ON messages (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), id);
CREATE INDEX IF NOT EXISTS messages_unread_idx ON messages (receiver_id, sender_id) WHERE read_at IS NULL;

-- 3) PROFILE PHOTO: images table ki row (Cloudinary ya database, purane upload jaisa)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_image_id INTEGER REFERENCES images(id) ON DELETE SET NULL;

-- 4) REPORTS: ab user aur private message ko bhi report kar sakte hain
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_type_chk;
ALTER TABLE reports ADD CONSTRAINT reports_type_chk
  CHECK (target_type IN ('comment', 'poll_comment', 'poll', 'user', 'message'));
