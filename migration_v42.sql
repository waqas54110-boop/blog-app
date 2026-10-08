-- V42: Group Poster — groups ki list, "aaj post ho gayi" tick, aur har group ki alag analytics.
-- Neon SQL Editor mein paste karke Run karo. Dobara chalane se koi nuqsan nahi (IF NOT EXISTS).

-- Har visit ke saath group ka UTM naam (utm_campaign) save hota hai
ALTER TABLE post_visits ADD COLUMN IF NOT EXISTS campaign VARCHAR(60);
CREATE INDEX IF NOT EXISTS post_visits_campaign_idx ON post_visits (campaign) WHERE campaign IS NOT NULL;

-- Tumhare groups (WhatsApp / Facebook / Telegram ...)
CREATE TABLE IF NOT EXISTS share_groups (
  id         SERIAL       PRIMARY KEY,
  name       VARCHAR(80)  NOT NULL,
  platform   VARCHAR(20)  NOT NULL DEFAULT 'whatsapp',
  link       VARCHAR(500),
  utm        VARCHAR(60)  NOT NULL UNIQUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- "Is post ko is group mein is din post kar diya" (✓)
CREATE TABLE IF NOT EXISTS share_posted (
  group_id   INTEGER     NOT NULL REFERENCES share_groups(id) ON DELETE CASCADE,
  post_id    INTEGER     NOT NULL REFERENCES posts(id)        ON DELETE CASCADE,
  posted_on  DATE        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, post_id, posted_on)
);
CREATE INDEX IF NOT EXISTS share_posted_day_idx ON share_posted (posted_on);
