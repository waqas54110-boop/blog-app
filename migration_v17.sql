-- migration_v17.sql
-- V17: Edit profile: bio, location, aur username badalne ki 30 din ki hadd.
-- Neon SQL Editor mein ek baar run karein. Dobara run karna safe hai. Deploy se PEHLE run karein.
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio                 VARCHAR(200);
ALTER TABLE users ADD COLUMN IF NOT EXISTS location            VARCHAR(60);
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;
