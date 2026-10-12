-- V60: Ludo (online multiplayer, /ludo). Dobara chalane se koi nuqsan nahi (IF NOT EXISTS).
-- Server start par ye file khud bhi chal jati hai.

-- Har room / game: poori game state JSON mein (khilari, goteyan, kiski baari, dice, timer).
CREATE TABLE IF NOT EXISTS ludo_games (
  id           SERIAL       PRIMARY KEY,
  code         VARCHAR(6)   NOT NULL UNIQUE,                    -- room code, jaise K7M2P
  host_id      INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       VARCHAR(10)  NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'finished')),
  max_players  SMALLINT     NOT NULL DEFAULT 4 CHECK (max_players BETWEEN 2 AND 4),
  visibility   VARCHAR(8)   NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  state        JSONB        NOT NULL,
  version      INTEGER      NOT NULL DEFAULT 1,                 -- har badlav par barhta hai (browser sirf naya state leta hai)
  members      INTEGER[]    NOT NULL DEFAULT '{}',              -- jo insaan abhi is game mein hain (bot nahi)
  winner_id    INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ludo_games_status_idx  ON ludo_games (status, updated_at);
CREATE INDEX IF NOT EXISTS ludo_games_members_idx ON ludo_games USING GIN (members);

-- Leaderboard: sirf wo games jin mein kam az kam 2 asal insaan thay.
CREATE TABLE IF NOT EXISTS ludo_stats (
  user_id     INTEGER      PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  played      INTEGER      NOT NULL DEFAULT 0,
  won         INTEGER      NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
