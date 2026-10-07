-- migration_v39.sql
-- V39: Advertise on Khabzo (banner ads, sponsored feed posts, Local Businesses listings, pay-per-click wallet, sponsored contest enquiries).
-- Run once in the Neon SQL Editor. Safe to run again. Run it BEFORE you deploy.

CREATE TABLE IF NOT EXISTS ads (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('banner', 'feed', 'listing', 'cpc', 'contest')),
  -- pending = waiting for admin review, awaiting_payment = approved, money not received yet, active = running
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'awaiting_payment', 'active', 'paused', 'rejected', 'ended')),
  business_name VARCHAR(80) NOT NULL,
  tagline VARCHAR(120),
  body TEXT,
  link_url VARCHAR(500),
  phone VARCHAR(20),
  whatsapp VARCHAR(20),
  city VARCHAR(60),
  area VARCHAR(80),
  category VARCHAR(40),
  image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
  placement VARCHAR(8) NOT NULL DEFAULT 'all' CHECK (placement IN ('home', 'feed', 'post', 'all')),
  units INTEGER,                              -- weeks (banner) / days (feed) / months (listing)
  price_rs INTEGER NOT NULL DEFAULT 0,        -- price of fixed packages (calculated by the server)
  paid_at TIMESTAMPTZ,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  cpc_paise INTEGER,                          -- pay-per-click: paise charged for every real click
  spent_paise BIGINT NOT NULL DEFAULT 0,
  admin_note VARCHAR(300),
  views INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_user_idx ON ads (user_id, id DESC);
CREATE INDEX IF NOT EXISTS ads_serve_idx ON ads (status, kind);

-- Daily views / clicks (for the report)
CREATE TABLE IF NOT EXISTS ad_daily (
  ad_id INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ad_id, day)
);

-- One visitor counts as one click per ad per day (visitor = hash of ip + browser)
CREATE TABLE IF NOT EXISTS ad_click_seen (
  ad_id INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  visitor VARCHAR(40) NOT NULL,
  day DATE NOT NULL,
  PRIMARY KEY (ad_id, visitor, day)
);

-- Advertiser wallet (for pay-per-click), in paise
CREATE TABLE IF NOT EXISTS ad_wallets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_paise BIGINT NOT NULL DEFAULT 0 CHECK (balance_paise >= 0),
  total_topup_paise BIGINT NOT NULL DEFAULT 0,
  total_spent_paise BIGINT NOT NULL DEFAULT 0
);

-- Wallet top-up requests (advertiser pays by JazzCash / Easypaisa, the admin presses "approve")
CREATE TABLE IF NOT EXISTS ad_topups (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_rs INTEGER NOT NULL CHECK (amount_rs > 0),
  method VARCHAR(20) NOT NULL,
  txn_ref VARCHAR(60) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ad_topups_status_idx ON ad_topups (status, id DESC);
