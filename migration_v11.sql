-- migration_v11.sql
-- Sponsored contest + giveaway, homepage par live contest, Telegram auto-post.
-- Neon SQL Editor mein ek baar run karein. Dobara run karna bhi safe hai. Deploy se PEHLE run karein.
-- (migration_v9.sql aur migration_v10.sql pehle chal chuki honi chahiye.)

-- 1) Sponsor + prize
ALTER TABLE polls ADD COLUMN IF NOT EXISTS sponsor_name VARCHAR(80);
ALTER TABLE polls ADD COLUMN IF NOT EXISTS sponsor_url  TEXT;                 -- sponsor ki website (http/https)
ALTER TABLE polls ADD COLUMN IF NOT EXISTS sponsor_logo TEXT;                 -- /img/12
ALTER TABLE polls ADD COLUMN IF NOT EXISTS prize        VARCHAR(160);         -- "Win Rs 5,000 mobile load"
ALTER TABLE polls ADD COLUMN IF NOT EXISTS featured     BOOLEAN NOT NULL DEFAULT false;  -- homepage par pehle yehi dikhao

-- 2) Giveaway (random winner)
ALTER TABLE polls ADD COLUMN IF NOT EXISTS giveaway_pool     VARCHAR(10) NOT NULL DEFAULT 'all';  -- 'all' (saare voters) ya 'winner' (jeetne wale ko vote dene walay)
ALTER TABLE polls ADD COLUMN IF NOT EXISTS giveaway_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS giveaway_at       TIMESTAMPTZ;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS giveaway_count    INTEGER;                 -- draw ke waqt kitne log eligible thay
ALTER TABLE polls ADD COLUMN IF NOT EXISTS giveaway_redraws  INTEGER NOT NULL DEFAULT 0;

-- 3) Telegram: har contest ka "naya contest" aur "result" sirf ek baar jaye
ALTER TABLE polls ADD COLUMN IF NOT EXISTS tg_start_sent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS tg_end_sent   BOOLEAN NOT NULL DEFAULT false;

-- poll_events mein ab kind = 'click' (sponsor link click) bhi aata hai: koi table badalne ki zaroorat nahi.
