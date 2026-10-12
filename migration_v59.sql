-- V59: Office monitor (live online/offline, IP masle, alerts). Dobara chalane se koi nuqsan nahi (IF NOT EXISTS).
-- Server start par ye file khud bhi chal jati hai. migration_v58.sql pehle chali honi chahiye.

-- Har site ka monitor: akhri heartbeat kab aaya, kis computer se, DHCP check ka natija.
CREATE TABLE IF NOT EXISTS office_monitor (
  site          VARCHAR(80)  PRIMARY KEY,
  last_beat     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  host          VARCHAR(80),
  subnet        VARCHAR(50),
  gateway       VARCHAR(45),
  interval_s    INTEGER      NOT NULL DEFAULT 300,
  dhcp          JSONB,                                  -- {ran, servers:[ip], error}
  silent_alerted BOOLEAN     NOT NULL DEFAULT FALSE
);

-- Har device ka abhi ka haal (dev_key = 'mac:..' ya 'ip:..', office_assets wali chaabi)
CREATE TABLE IF NOT EXISTS office_status (
  site         VARCHAR(80)  NOT NULL,
  dev_key      VARCHAR(50)  NOT NULL,
  ip           VARCHAR(45),
  mac          VARCHAR(17),
  vendor       VARCHAR(120),
  name         VARCHAR(160),
  first_seen   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ,
  online       BOOLEAN      NOT NULL DEFAULT FALSE,
  rtt_ms       REAL,
  fail_count   INTEGER      NOT NULL DEFAULT 0,          -- lagatar kitni baar nazar nahi aaya
  since        TIMESTAMPTZ  NOT NULL DEFAULT now(),      -- is haal (online/offline) mein kab se
  in_scan      BOOLEAN      NOT NULL DEFAULT FALSE,      -- pichle scan ki list mein hai?
  marked_known BOOLEAN      NOT NULL DEFAULT FALSE,      -- admin ne kaha "ye mera hai"
  alerted_down BOOLEAN      NOT NULL DEFAULT FALSE,
  alerted_new  BOOLEAN      NOT NULL DEFAULT FALSE,
  PRIMARY KEY (site, dev_key)
);

-- Har 5 minute ki ping history (sirf scan wale devices ki). 3 din baad khud saaf.
CREATE TABLE IF NOT EXISTS office_pings (
  id      BIGSERIAL    PRIMARY KEY,
  site    VARCHAR(80)  NOT NULL,
  dev_key VARCHAR(50)  NOT NULL,
  at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  up      BOOLEAN      NOT NULL,
  rtt_ms  REAL
);
CREATE INDEX IF NOT EXISTS office_pings_idx ON office_pings (site, dev_key, at DESC);
CREATE INDEX IF NOT EXISTS office_pings_at_idx ON office_pings (at);

-- Kaun sa IP kis MAC ke paas hai (IP conflict pakadne ke liye)
CREATE TABLE IF NOT EXISTS office_ipmap (
  site         VARCHAR(80)  NOT NULL,
  ip           VARCHAR(45)  NOT NULL,
  mac          VARCHAR(17)  NOT NULL,
  since        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  changes      INTEGER      NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (site, ip)
);

-- Network ke masle: ip_conflict, link_local (169.254), rogue_dhcp, dhcp_other
CREATE TABLE IF NOT EXISTS office_issues (
  id         SERIAL       PRIMARY KEY,
  site       VARCHAR(80)  NOT NULL,
  kind       VARCHAR(20)  NOT NULL,
  ikey       VARCHAR(80)  NOT NULL,
  detail     VARCHAR(400) NOT NULL,
  first_seen TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  active     BOOLEAN      NOT NULL DEFAULT TRUE,
  UNIQUE (site, kind, ikey)
);
