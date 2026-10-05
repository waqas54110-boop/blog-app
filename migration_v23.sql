-- migration_v23.sql
-- V23: Analytics mein Age / Gender / Country + "ek banda kitni bar aaya" (repeat clicks).
-- Neon SQL Editor mein ek baar run karein. Dobara run karna safe hai. Deploy se PEHLE run karein.

-- 1) Users ki apni info (sab optional; signup aur Edit profile se bharti hai)
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_year SMALLINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender     VARCHAR(10);
ALTER TABLE users ADD COLUMN IF NOT EXISTS country    VARCHAR(2);

-- 2) Har visit ke saath: kaun (visitor), kahan se (country), kis group ka (gender / age_group)
ALTER TABLE post_visits ADD COLUMN IF NOT EXISTS visitor   VARCHAR(20);
ALTER TABLE post_visits ADD COLUMN IF NOT EXISTS user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE post_visits ADD COLUMN IF NOT EXISTS country   VARCHAR(2);
ALTER TABLE post_visits ADD COLUMN IF NOT EXISTS gender    VARCHAR(10);
ALTER TABLE post_visits ADD COLUMN IF NOT EXISTS age_group VARCHAR(10);

CREATE INDEX IF NOT EXISTS post_visits_visitor_idx ON post_visits (visitor);
CREATE INDEX IF NOT EXISTS post_visits_country_idx ON post_visits (country);
