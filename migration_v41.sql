-- V41: private chat — reply to a message, emoji reactions, delete for everyone.
-- Neon SQL Editor mein paste karke Run karo. Dobara chalane se koi nuqsan nahi (IF NOT EXISTS).

ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to   INTEGER REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id INTEGER     NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    INTEGER     NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  emoji      VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS message_reactions_msg_idx ON message_reactions (message_id);
