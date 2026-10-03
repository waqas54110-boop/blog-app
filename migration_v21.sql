-- V21: Group invite links (Neon SQL Editor mein ek baar run karo)
-- Har group ko khud ba khud 32-character ka random token milta hai (purane groups ko bhi).
ALTER TABLE groups ADD COLUMN IF NOT EXISTS invite_token TEXT
  DEFAULT replace(gen_random_uuid()::text, '-', '');

-- Agar kisi row mein NULL reh gaya ho
UPDATE groups SET invite_token = replace(gen_random_uuid()::text, '-', '') WHERE invite_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS groups_invite_token_uq ON groups (invite_token);
