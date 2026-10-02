-- migration_v19.sql
-- V19: Feed posts par views ka count (Facebook jaisa).
-- Neon SQL Editor mein ek baar run karein. Dobara run karna safe hai. Deploy se PEHLE run karein.
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS views INTEGER NOT NULL DEFAULT 0;
