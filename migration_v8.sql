-- migration_v8.sql
-- Vote Contest: do options (har ek ki image ke sath) par voting. Kisi bhi topic par (politics, dost, cricket, kuch bhi).
-- Neon SQL Editor mein ek baar run karein. Dobara run karna bhi safe hai. Deploy se PEHLE run karein.

CREATE TABLE IF NOT EXISTS polls (
  id         SERIAL PRIMARY KEY,
  title      VARCHAR(150) NOT NULL,               -- e.g. "Kaun behtar hai?"
  a_name     VARCHAR(60)  NOT NULL,
  a_image    TEXT         NOT NULL,               -- /img/12
  b_name     VARCHAR(60)  NOT NULL,
  b_image    TEXT         NOT NULL,
  ends_at    TIMESTAMPTZ,                         -- khali = jab tak admin band na kare
  is_closed  BOOLEAN      NOT NULL DEFAULT false,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS polls_created_idx ON polls (created_at DESC);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id    INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pick       CHAR(1) NOT NULL CHECK (pick IN ('a','b')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);
