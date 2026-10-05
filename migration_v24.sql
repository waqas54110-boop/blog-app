-- migration_v24.sql
-- V24: Voice call + Video call (chat mein). WebRTC, signaling database ke zariye.
-- Neon SQL Editor mein ek baar run karein. Dobara run karna safe hai. Deploy se PEHLE run karein.

CREATE TABLE IF NOT EXISTS calls (
  id          BIGSERIAL PRIMARY KEY,
  caller_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        VARCHAR(5)  NOT NULL CHECK (kind IN ('audio', 'video')),
  status      VARCHAR(10) NOT NULL DEFAULT 'ringing'
              CHECK (status IN ('ringing', 'active', 'ended', 'declined', 'missed', 'cancelled')),
  caller_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  callee_seen TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ,
  ended_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS calls_callee_ringing_idx ON calls (callee_id) WHERE status = 'ringing';
CREATE INDEX IF NOT EXISTS calls_caller_idx ON calls (caller_id, status);
CREATE INDEX IF NOT EXISTS calls_callee_idx ON calls (callee_id, status);

-- WebRTC offer / answer / ICE candidates (chhote, kuch ghanton mein delete ho jate hain)
CREATE TABLE IF NOT EXISTS call_signals (
  id         BIGSERIAL PRIMARY KEY,
  call_id    BIGINT  NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  from_user  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(10) NOT NULL CHECK (type IN ('offer', 'answer', 'ice')),
  payload    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_signals_call_idx ON call_signals (call_id, id);
