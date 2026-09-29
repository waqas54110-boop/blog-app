-- migration_v5.sql
-- Traffic features: push notifications, IndexNow tracking, "updated" date for Google.
-- Neon SQL Editor mein ek baar run karein. Dobara run karna bhi safe hai.
-- Deploy se PEHLE run karein.

-- 1) Post ki last-edit date (Google ke structured data ke liye)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- 2) Kaun si post IndexNow / push par ja chuki.
--    Purani posts ko "sent" mark karte hain taake deploy par sab dobara na jayen.
--    (Pehle DEFAULT TRUE se column banta hai, phir default FALSE; dobara run karne par kuch nahi badalta.)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS indexnow_sent BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE posts ALTER COLUMN indexnow_sent SET DEFAULT FALSE;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS push_sent BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE posts ALTER COLUMN push_sent SET DEFAULT FALSE;

-- 3) Push subscriptions (har browser/phone ka ek row)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         SERIAL PRIMARY KEY,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4) Chhoti settings (VAPID keys yahan khud save ho jati hain, .env mein kuch nahi likhna)
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
