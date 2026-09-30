-- migration_v10.sql
-- Email verification + Google login.
-- Neon SQL Editor mein ek baar run karein. Dobara run karna bhi safe hai.
-- Deploy se PEHLE run karein.

-- 1) Users table: verified flag + Google id. Google se aane wale users ka password nahi hota.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'email_verified'
  ) THEN
    ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT false;
    -- Jo users pehle se hain unhein verified maan lo (warna sab login se bahar ho jayenge).
    -- Ye sirf pehli baar chalta hai, dobara run karne par kisi ko verified nahi karta.
    UPDATE users SET email_verified = true;
  END IF;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_key ON users (google_id) WHERE google_id IS NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 2) Verification links (DB mein sirf token ka hash jata hai)
CREATE TABLE IF NOT EXISTS email_verifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_verifications_user_idx ON email_verifications (user_id);
