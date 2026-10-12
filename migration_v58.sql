-- V58: Office devices (scanner se aayi list). Dobara chalane se koi nuqsan nahi (IF NOT EXISTS).
-- Server start par ye file khud bhi chal jati hai.

-- Har scan ek row; devices alag table mein.
CREATE TABLE IF NOT EXISTS office_scans (
  id           SERIAL       PRIMARY KEY,
  site         VARCHAR(80)  NOT NULL,
  subnet       VARCHAR(50),
  scanner      VARCHAR(80),
  scanned_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  device_count INTEGER      NOT NULL DEFAULT 0,
  source       VARCHAR(10)  NOT NULL DEFAULT 'upload',   -- upload (token) ya import (admin ne file di)
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS office_scans_site_idx ON office_scans (site, scanned_at DESC);

CREATE TABLE IF NOT EXISTS office_devices (
  id         SERIAL       PRIMARY KEY,
  scan_id    INTEGER      NOT NULL REFERENCES office_scans(id) ON DELETE CASCADE,
  ip         VARCHAR(45)  NOT NULL,
  mac        VARCHAR(17),
  vendor     VARCHAR(120),
  hostname   VARCHAR(120),
  ports      INTEGER[]    NOT NULL DEFAULT '{}',
  web_title  VARCHAR(100),
  server     VARCHAR(100),
  dev_type   VARCHAR(12)  NOT NULL DEFAULT 'unknown',
  label      VARCHAR(160),
  is_self    BOOLEAN      NOT NULL DEFAULT FALSE,
  is_gateway BOOLEAN      NOT NULL DEFAULT FALSE,
  random_mac BOOLEAN      NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS office_devices_scan_idx ON office_devices (scan_id);
CREATE INDEX IF NOT EXISTS office_devices_mac_idx ON office_devices (mac);

-- Admin ki apni sahi ki hui jaankari (naam, qisam, jagah, note). MAC se jud-ti hai, isliye
-- agle scan mein bhi wahi naam dikhta hai. MAC na ho to IP se.
CREATE TABLE IF NOT EXISTS office_assets (
  id         SERIAL       PRIMARY KEY,
  site       VARCHAR(80)  NOT NULL,
  dev_key    VARCHAR(50)  NOT NULL,                      -- 'mac:aa:bb:..' ya 'ip:192.168.1.5'
  name       VARCHAR(120),
  dev_type   VARCHAR(12),
  location   VARCHAR(80),
  note       VARCHAR(300),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (site, dev_key)
);
