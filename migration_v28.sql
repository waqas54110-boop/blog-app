-- migration_v28.sql
-- V28: Live ki recording save hona + media server (LiveKit) mode.
-- Neon SQL Editor mein ek baar run karein (migration_v27.sql ke BAAD). Dobara run karna safe hai. Deploy se PEHLE run karein.

-- Live khatam hone par recording (videos table mein; /video/ID se chalti hai)
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS video_id INTEGER REFERENCES videos(id) ON DELETE SET NULL;
-- 'p2p' = seedha browser se browser (chhoti audience), 'sfu' = LiveKit media server (bari audience)
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS mode VARCHAR(4) NOT NULL DEFAULT 'p2p';
