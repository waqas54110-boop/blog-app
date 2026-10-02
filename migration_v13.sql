-- migration_v13.sql
-- V13: Public profile + follow, Report/Moderation queue + spam filter, Referral/invite link.
-- Neon SQL Editor mein ek baar run karein. Dobara run karna safe hai. Deploy se PEHLE run karein.
-- (migration_v9.sql aur migration_v11.sql pehle chal chuki honi chahiye.)

-- 1) FOLLOW: kaun kis ko follow karta hai (notify_email = naya post/contest par email bhi bhejo)
CREATE TABLE IF NOT EXISTS follows (
  follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notify_email BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT follows_not_self CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS follows_followee_idx ON follows (followee_id);

-- Followers ko notification har post / contest par sirf ek baar jaye.
-- Purani posts/contests "sent" mark hoti hain (deploy par purane content ki notifications ka toofan na aaye).
-- (Pehle DEFAULT TRUE se column banta hai, phir default FALSE; dobara run karne par kuch nahi badalta.)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS followers_sent BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE posts ALTER COLUMN followers_sent SET DEFAULT FALSE;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS followers_sent BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE polls ALTER COLUMN followers_sent SET DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS posts_followers_pending_idx ON posts (id) WHERE followers_sent = false;
CREATE INDEX IF NOT EXISTS polls_followers_pending_idx ON polls (id) WHERE followers_sent = false;

-- 2) REPORTS + MODERATION
-- reporter_id NULL = spam filter ne khud queue mein daala
CREATE TABLE IF NOT EXISTS reports (
  id          SERIAL PRIMARY KEY,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_type VARCHAR(12) NOT NULL,                 -- comment | poll_comment | poll
  target_id   INTEGER NOT NULL,
  reason      VARCHAR(20) NOT NULL,                 -- spam | abuse | hate | misleading | other
  details     VARCHAR(300),
  status      VARCHAR(12) NOT NULL DEFAULT 'open',  -- open | resolved | dismissed
  handled_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handled_at  TIMESTAMPTZ,
  action      VARCHAR(20),                          -- delete | close | dismiss | restore (admin ne kya kiya)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reports_type_chk   CHECK (target_type IN ('comment', 'poll_comment', 'poll')),
  CONSTRAINT reports_status_chk CHECK (status IN ('open', 'resolved', 'dismissed'))
);
-- Ek user ek cheez ko ek hi baar report kar sakta hai
CREATE UNIQUE INDEX IF NOT EXISTS reports_one_per_user_idx ON reports (reporter_id, target_type, target_id) WHERE reporter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_target_idx ON reports (target_type, target_id);

-- Bahut reports (ya spam filter) par comment "hidden" ho jata hai jab tak admin dekh na le
ALTER TABLE comments      ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE poll_comments ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;

-- 3) REFERRAL: har user ka apna invite code, aur kis ne kis ko bulaya
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(12);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by   INTEGER REFERENCES users(id) ON DELETE SET NULL;
UPDATE users SET referral_code = substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 8)
 WHERE referral_code IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_key ON users (referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_referred_by_idx ON users (referred_by) WHERE referred_by IS NOT NULL;

-- Giveaway: admin chahe to zyada log laane walon ko extra entries mil jayein (default band)
ALTER TABLE polls ADD COLUMN IF NOT EXISTS giveaway_ref_bonus BOOLEAN NOT NULL DEFAULT false;
