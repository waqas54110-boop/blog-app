-- migration_v34.sql
-- V34: People's Court (Awam ki Adalat) + Raise Your Voice (local petitions).
-- Neon SQL Editor mein ek baar run karein (migration_v30.sql ke BAAD). Dobara run karna safe hai. Deploy se PEHLE run karein.

-- ============ PEOPLE'S COURT ============
CREATE TABLE IF NOT EXISTS court_cases (
  id SERIAL PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  summary TEXT NOT NULL,                         -- neutral background (admin likhta hai)
  side_a VARCHAR(60) NOT NULL,
  side_b VARCHAR(60) NOT NULL,
  recruit_until TIMESTAMPTZ NOT NULL,            -- is waqt tak dono wakeel aane chahiyen
  jury_hours INTEGER NOT NULL DEFAULT 24 CHECK (jury_hours BETWEEN 1 AND 168),
  jury_starts_at TIMESTAMPTZ,                    -- dono wakeel dalail de dein to khud set
  jury_ends_at TIMESTAMPTZ,
  verdict VARCHAR(4),                            -- a | b | tie | none (jury band hone par)
  votes_a INTEGER,
  votes_b INTEGER,
  verdict_sent BOOLEAN NOT NULL DEFAULT false,
  jury_sent BOOLEAN NOT NULL DEFAULT false,
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  shares INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS court_cases_created_idx ON court_cases (created_at DESC);

-- Har side ka ek wakeel (UNIQUE), aur ek user ek case mein sirf ek side ka wakeel
CREATE TABLE IF NOT EXISTS court_lawyers (
  id SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES court_cases(id) ON DELETE CASCADE,
  side CHAR(1) NOT NULL CHECK (side IN ('a', 'b')),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opening TEXT NOT NULL,
  tagline VARCHAR(140) NOT NULL,
  closing VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, side),
  UNIQUE (case_id, user_id)
);

-- Jury ka vote (ek user ek vote). via = kis wakeel ke link se aaya (a / b / NULL)
CREATE TABLE IF NOT EXISTS court_votes (
  case_id INTEGER NOT NULL REFERENCES court_cases(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  side CHAR(1) NOT NULL CHECK (side IN ('a', 'b')),
  via CHAR(1) CHECK (via IN ('a', 'b')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, user_id)
);
CREATE INDEX IF NOT EXISTS court_votes_case_idx ON court_votes (case_id, side);

-- ============ RAISE YOUR VOICE (PETITIONS) ============
CREATE TABLE IF NOT EXISTS petitions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  body TEXT NOT NULL,
  city VARCHAR(60) NOT NULL,
  area VARCHAR(80),
  category VARCHAR(20) NOT NULL,
  image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'closed')),
  outcome VARCHAR(500),                          -- "resolved" par kya hua
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  sign_count INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  milestone_notified INTEGER NOT NULL DEFAULT 0, -- sab se bada milestone jis ki notification ja chuki
  milestone_posted INTEGER NOT NULL DEFAULT 0,   -- admin ne social media par post kar diya
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS petitions_list_idx ON petitions (is_hidden, created_at DESC);
CREATE INDEX IF NOT EXISTS petitions_city_idx ON petitions (lower(city));

CREATE TABLE IF NOT EXISTS petition_signatures (
  petition_id INTEGER NOT NULL REFERENCES petitions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (petition_id, user_id)
);
CREATE INDEX IF NOT EXISTS petition_sig_recent_idx ON petition_signatures (petition_id, created_at DESC);
CREATE INDEX IF NOT EXISTS petition_sig_time_idx ON petition_signatures (created_at);

CREATE TABLE IF NOT EXISTS petition_updates (
  id SERIAL PRIMARY KEY,
  petition_id INTEGER NOT NULL REFERENCES petitions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body VARCHAR(600) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS petition_updates_idx ON petition_updates (petition_id, id DESC);

-- ============ REPORTS: nayi qismein ============
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_type_chk;
ALTER TABLE reports ADD CONSTRAINT reports_type_chk
  CHECK (target_type IN ('comment', 'poll_comment', 'poll', 'user', 'message', 'feed_post', 'feed_comment', 'petition', 'court_case'));
