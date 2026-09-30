-- migration_v9.sql
-- Vote Contest V9: 2+ options, knockout (4/8), post ke andar widget, analytics events, contest comments.
-- Neon SQL Editor mein ek baar run karein. Dobara run karna bhi safe hai. Deploy se PEHLE run karein.
-- (migration_v8.sql pehle chal chuki honi chahiye.)

-- 1) polls ke naye columns
ALTER TABLE polls ADD COLUMN IF NOT EXISTS kind             VARCHAR(10) NOT NULL DEFAULT 'vote';  -- 'vote' ya 'knockout'
ALTER TABLE polls ADD COLUMN IF NOT EXISTS round_hours      INTEGER;                              -- knockout: har round kitne ghante (khali = admin khud agla round chalata hai)
ALTER TABLE polls ADD COLUMN IF NOT EXISTS current_round    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS round_ends_at    TIMESTAMPTZ;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS winner_option_id INTEGER;

-- purane a_/b_ columns ab zaroori nahi (options alag table mein), magar purana data wahin rehne dete hain
ALTER TABLE polls ALTER COLUMN a_name  DROP NOT NULL;
ALTER TABLE polls ALTER COLUMN a_image DROP NOT NULL;
ALTER TABLE polls ALTER COLUMN b_name  DROP NOT NULL;
ALTER TABLE polls ALTER COLUMN b_image DROP NOT NULL;

-- 2) options: har contest ke 2 se zyada naam/image
CREATE TABLE IF NOT EXISTS poll_options (
  id      SERIAL PRIMARY KEY,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  pos     SMALLINT NOT NULL,                 -- 0,1,2... (knockout mein seed / bracket ki tarteeb)
  name    VARCHAR(60) NOT NULL,
  image   TEXT NOT NULL,
  UNIQUE (poll_id, pos)
);

-- purane (V8) contests ke do options nayi table mein copy
INSERT INTO poll_options (poll_id, pos, name, image)
SELECT p.id, 0, p.a_name, p.a_image FROM polls p
WHERE p.a_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM poll_options o WHERE o.poll_id = p.id AND o.pos = 0);

INSERT INTO poll_options (poll_id, pos, name, image)
SELECT p.id, 1, p.b_name, p.b_image FROM polls p
WHERE p.b_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM poll_options o WHERE o.poll_id = p.id AND o.pos = 1);

-- 3) poll_votes: 'a'/'b' ki jagah option_id, aur vote kahan se aaya (whatsapp/facebook/...)
ALTER TABLE poll_votes ADD COLUMN IF NOT EXISTS option_id INTEGER REFERENCES poll_options(id) ON DELETE CASCADE;
ALTER TABLE poll_votes ADD COLUMN IF NOT EXISTS source    VARCHAR(40);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'poll_votes' AND column_name = 'pick') THEN
    UPDATE poll_votes v
       SET option_id = o.id
      FROM poll_options o
     WHERE o.poll_id = v.poll_id
       AND o.pos = CASE v.pick WHEN 'a' THEN 0 ELSE 1 END
       AND v.option_id IS NULL;
    ALTER TABLE poll_votes DROP COLUMN pick;
  END IF;
END $$;

DELETE FROM poll_votes WHERE option_id IS NULL;
ALTER TABLE poll_votes ALTER COLUMN option_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS poll_votes_poll_idx ON poll_votes (poll_id, option_id);

-- 4) Knockout: matches (har round mein jeetne wala agle round mein)
CREATE TABLE IF NOT EXISTS poll_matches (
  id               SERIAL PRIMARY KEY,
  poll_id          INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  round            SMALLINT NOT NULL,
  slot             SMALLINT NOT NULL,
  a_option_id      INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  b_option_id      INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  winner_option_id INTEGER REFERENCES poll_options(id) ON DELETE SET NULL,
  UNIQUE (poll_id, round, slot)
);

CREATE TABLE IF NOT EXISTS poll_match_votes (
  match_id   INTEGER NOT NULL REFERENCES poll_matches(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  poll_id    INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id  INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  source     VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);
CREATE INDEX IF NOT EXISTS poll_match_votes_poll_idx ON poll_match_votes (poll_id, created_at);

-- 5) Analytics events: contest kitne logon ne kholay, share kitne hue, kahan se aaye
CREATE TABLE IF NOT EXISTS poll_events (
  id         BIGSERIAL PRIMARY KEY,
  poll_id    INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  kind       VARCHAR(10) NOT NULL,           -- 'view' ya 'share'
  source     VARCHAR(40),                    -- whatsapp / facebook / google / direct ...
  via        VARCHAR(10),                    -- 'page' (contest ka apna page) ya 'post' (blog post ke andar widget)
  visitor    VARCHAR(32),                    -- random cookie id: "kitne alag log" ginne ke liye
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS poll_events_poll_idx    ON poll_events (poll_id, created_at);
CREATE INDEX IF NOT EXISTS poll_events_created_idx ON poll_events (created_at);
CREATE INDEX IF NOT EXISTS poll_votes_created_idx  ON poll_votes (created_at);

-- 6) Contest par comments (replies ke sath, post comments ki tarah)
CREATE TABLE IF NOT EXISTS poll_comments (
  id         SERIAL PRIMARY KEY,
  poll_id    INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  parent_id  INTEGER REFERENCES poll_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS poll_comments_poll_idx ON poll_comments (poll_id, created_at);

-- 7) Kisi bhi post mein contest lagana
ALTER TABLE posts ADD COLUMN IF NOT EXISTS poll_id INTEGER REFERENCES polls(id) ON DELETE SET NULL;
