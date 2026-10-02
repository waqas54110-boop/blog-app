-- migration_v14.sql
-- V14: Friend requests (Facebook jaisa). Request bhejo -> samne wala accept kare -> dono ek doosre ko follow karne lagte hain.
-- Neon SQL Editor mein ek baar run karein. Dobara run karna safe hai. Deploy se PEHLE run karein.
-- (migration_v13.sql pehle chal chuki ho: follows table chahiye.)

CREATE TABLE IF NOT EXISTS friend_requests (
  sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  PRIMARY KEY (sender_id, receiver_id),
  CONSTRAINT friend_requests_not_self CHECK (sender_id <> receiver_id)
);
-- Ek jodi (A,B) ke darmiyan sirf ek row: A->B aur B->A dono nahi ho sakti
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pair_uq
  ON friend_requests (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id));
CREATE INDEX IF NOT EXISTS friend_requests_receiver_idx ON friend_requests (receiver_id, status);
