-- migration_v27.sql
-- V27: Live broadcasting (post box mein "🔴 Live"). Host camera se live aata hai, doosre log post par "Watch live" dabate hain.
-- Neon SQL Editor mein ek baar run karein. Dobara run karna safe hai. Deploy se PEHLE run karein.
-- (migration_v18.sql pehle chal chuki ho: feed_posts table chahiye.)

CREATE TABLE IF NOT EXISTS live_streams (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id      INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,  -- post delete ho to live bhi khatam
  status       VARCHAR(6) NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended')),
  host_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),   -- host ka "main zinda hoon" ishara
  peak_viewers INTEGER NOT NULL DEFAULT 0,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS live_streams_post_uq ON live_streams (post_id);
-- Ek banda ek waqt mein sirf ek live kar sakta hai
CREATE UNIQUE INDEX IF NOT EXISTS live_streams_one_live_uq ON live_streams (user_id) WHERE status = 'live';

-- Har dekhne wale ka ek "session" (WebRTC connection isi ke naam se banta hai)
CREATE TABLE IF NOT EXISTS live_viewers (
  id        BIGSERIAL PRIMARY KEY,
  stream_id BIGINT  NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS live_viewers_stream_idx ON live_viewers (stream_id, left_at);

-- WebRTC offer / answer / ICE (chhote, ek din mein delete ho jate hain)
CREATE TABLE IF NOT EXISTS live_signals (
  id         BIGSERIAL PRIMARY KEY,
  stream_id  BIGINT NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  sess       BIGINT NOT NULL REFERENCES live_viewers(id) ON DELETE CASCADE,
  from_host  BOOLEAN NOT NULL,
  type       VARCHAR(10) NOT NULL CHECK (type IN ('offer', 'answer', 'ice')),
  payload    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_signals_host_idx ON live_signals (stream_id, id) WHERE NOT from_host;
CREATE INDEX IF NOT EXISTS live_signals_viewer_idx ON live_signals (sess, id) WHERE from_host;
