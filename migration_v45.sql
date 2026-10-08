-- V45: Daily Rates (dollar, gold, silver, petrol, namaz timings). Neon SQL Editor mein paste karke Run karo.
-- Dobara chalane se koi nuqsan nahi (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS rates_history (
  key        VARCHAR(30)   NOT NULL,           -- usd_pkr, eur_pkr, xau_usd, petrol, diesel, gold_premium ...
  day        DATE          NOT NULL,           -- Pakistan ki taareekh
  value      NUMERIC(16,4) NOT NULL,
  source     VARCHAR(10)   NOT NULL DEFAULT 'auto',   -- auto | manual
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (key, day)
);
CREATE INDEX IF NOT EXISTS rates_history_key_day_idx ON rates_history (key, day DESC);
