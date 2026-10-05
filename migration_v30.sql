-- migration_v30.sql
-- V30: Parhne ka inaam (blog post 1 minute parhna, har post sirf ek baar) + invite ka inaam.
-- Neon SQL Editor mein ek baar run karein (migration_v29.sql ke BAAD). Dobara run karna safe hai. Deploy se PEHLE run karein.

-- Har inaam ka ek record. UNIQUE hone ki wajah se ek user ko ek post / ek dost ka inaam do baar mil hi nahi sakta
CREATE TABLE IF NOT EXISTS earn_events (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       VARCHAR(8) NOT NULL CHECK (kind IN ('read', 'invite')),
  ref_id     INTEGER NOT NULL,            -- read: post id, invite: bulaye hue dost ki user id
  paisa      INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS earn_events_uq ON earn_events (user_id, kind, ref_id);
CREATE INDEX IF NOT EXISTS earn_events_day_idx ON earn_events (user_id, kind, created_at);
