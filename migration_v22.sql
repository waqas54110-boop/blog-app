-- migration_v22.sql
-- V22: Group chat, private groups (join request / add members), DM photo + voice message, typing indicator, "seen" tick.
-- Neon SQL Editor mein ek baar run karein. Dobara run karna safe hai. Deploy se PEHLE run karein.
-- (migration_v15.sql, migration_v20.sql aur migration_v21.sql pehle chal chuki hon.)

-- 1) PRIVATE GROUPS: private group ki posts / chat / members sirf members ko dikhte hain
ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS group_join_requests (
  group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS group_join_requests_user_idx ON group_join_requests (user_id);

-- 2) GROUP CHAT: har group ki apni chat (sirf members)
CREATE TABLE IF NOT EXISTS group_messages (
  id         SERIAL PRIMARY KEY,
  group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       VARCHAR(1000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS group_messages_group_idx ON group_messages (group_id, id);

-- 3) PRIVATE MESSAGES MEIN PHOTO / VOICE: file database mein, sirf bhejne aur wasool karne wale ko dikhti hai
CREATE TABLE IF NOT EXISTS message_media (
  id          SERIAL PRIMARY KEY,
  uploader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        VARCHAR(6) NOT NULL,
  mime        VARCHAR(30) NOT NULL,
  data        BYTEA NOT NULL,
  size        INTEGER NOT NULL,
  duration    SMALLINT,                       -- voice ke seconds
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT message_media_kind_chk CHECK (kind IN ('image', 'voice'))
);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_id INTEGER REFERENCES message_media(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS messages_media_idx ON messages (media_id) WHERE media_id IS NOT NULL;

-- 4) TYPING INDICATOR: "X is typing..." (scope = 'dm:1-2' ya 'g:5'); 6 second se purani entry ignore hoti hai
CREATE TABLE IF NOT EXISTS typing_status (
  scope      VARCHAR(40) NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, user_id)
);
