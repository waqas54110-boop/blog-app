-- V55: Analytics upgrade — Device+Browser, Visitor journey, Bots tab, ISP/VPN
-- Neon SQL Editor mein poora paste karke chalayen. Dobara chalane se kuch nahi bigarta.

-- 1) Device / browser / OS / phone brand (blog visits + shop product visits)
ALTER TABLE post_visits    ADD COLUMN IF NOT EXISTS device  VARCHAR(10);
ALTER TABLE post_visits    ADD COLUMN IF NOT EXISTS os      VARCHAR(20);
ALTER TABLE post_visits    ADD COLUMN IF NOT EXISTS browser VARCHAR(30);
ALTER TABLE post_visits    ADD COLUMN IF NOT EXISTS brand   VARCHAR(20);
ALTER TABLE post_visits    ADD COLUMN IF NOT EXISTS inapp   BOOLEAN;
ALTER TABLE product_visits ADD COLUMN IF NOT EXISTS device  VARCHAR(10);
ALTER TABLE product_visits ADD COLUMN IF NOT EXISTS os      VARCHAR(20);
ALTER TABLE product_visits ADD COLUMN IF NOT EXISTS browser VARCHAR(30);
ALTER TABLE product_visits ADD COLUMN IF NOT EXISTS brand   VARCHAR(20);
ALTER TABLE product_visits ADD COLUMN IF NOT EXISTS inapp   BOOLEAN;

-- 2) Visitor journey: visitor ke saare visits time ke hisab se
CREATE INDEX IF NOT EXISTS post_visits_visitor_time_idx    ON post_visits (visitor, created_at);
CREATE INDEX IF NOT EXISTS product_visits_visitor_time_idx ON product_visits (visitor, created_at);

-- 3) Bots alag table mein (insani visits ke numbers saaf rehte hain)
CREATE TABLE IF NOT EXISTS bot_visits (
  id         BIGSERIAL    PRIMARY KEY,
  bot        VARCHAR(40)  NOT NULL,       -- Googlebot, Facebook preview, curl ...
  kind       VARCHAR(12)  NOT NULL,       -- search / social / seo / ai / monitor / script / other
  path       VARCHAR(255),
  ip         VARCHAR(45),
  country    VARCHAR(2),
  ua         VARCHAR(200),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bot_visits_time_idx ON bot_visits (created_at DESC);
CREATE INDEX IF NOT EXISTS bot_visits_bot_idx  ON bot_visits (bot, created_at DESC);

-- 4) ISP / VPN cache (har IP ek hi baar lookup hota hai)
CREATE TABLE IF NOT EXISTS ip_info (
  ip         VARCHAR(45)  PRIMARY KEY,
  asn        VARCHAR(20),
  isp        VARCHAR(120),
  is_mobile  BOOLEAN      NOT NULL DEFAULT false,   -- mobile data (Jazz/Zong/Telenor/Ufone)
  is_vpn     BOOLEAN      NOT NULL DEFAULT false,
  is_proxy   BOOLEAN      NOT NULL DEFAULT false,
  is_tor     BOOLEAN      NOT NULL DEFAULT false,
  is_hosting BOOLEAN      NOT NULL DEFAULT false,   -- datacenter / cloud server
  source     VARCHAR(12),                           -- ipapi / guess
  fetched_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
