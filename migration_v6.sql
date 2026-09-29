-- migration_v6.sql
-- Video upload + "Hire Me" inquiries inbox.
-- Neon SQL Editor mein ek baar run karein. Dobara run karna bhi safe hai.
-- Deploy se PEHLE run karein.

-- 1) Uploaded videos (mp4 / webm). Images ki tarah database mein save hoti hain.
CREATE TABLE IF NOT EXISTS videos (
  id          SERIAL PRIMARY KEY,
  mime        VARCHAR(30) NOT NULL,
  data        BYTEA NOT NULL,
  size        INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) "Hire Me" form se aayi hui inquiries
CREATE TABLE IF NOT EXISTS inquiries (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(150) NOT NULL,
  service    VARCHAR(60)  NOT NULL,
  budget     VARCHAR(40),
  message    TEXT NOT NULL,
  status     VARCHAR(20)  NOT NULL DEFAULT 'new',   -- new | replied | closed
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inquiries_status_idx ON inquiries (status, created_at DESC);
