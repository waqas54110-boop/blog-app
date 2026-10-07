-- V35: Street Cricket Manager (/cricket). Run once in the Neon SQL Editor. Safe to run again.

CREATE TABLE IF NOT EXISTS cricket_tournaments (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  city VARCHAR(60) NOT NULL DEFAULT '',
  overs INTEGER NOT NULL DEFAULT 6 CHECK (overs BETWEEN 1 AND 50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cricket_t_owner_idx ON cricket_tournaments (owner_id, id DESC);

CREATE TABLE IF NOT EXISTS cricket_teams (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES cricket_tournaments(id) ON DELETE CASCADE,
  name VARCHAR(40) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cricket_team_name_idx ON cricket_teams (tournament_id, lower(name));

-- A player belongs to an organizer's roster (matched by name), so a career is joined across that organizer's tournaments
CREATE TABLE IF NOT EXISTS cricket_players (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(40) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cricket_player_name_idx ON cricket_players (owner_id, lower(name));

CREATE TABLE IF NOT EXISTS cricket_team_players (
  team_id INTEGER NOT NULL REFERENCES cricket_teams(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES cricket_players(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, player_id)
);

CREATE TABLE IF NOT EXISTS cricket_matches (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES cricket_tournaments(id) ON DELETE CASCADE,
  team_a INTEGER NOT NULL REFERENCES cricket_teams(id) ON DELETE CASCADE,
  team_b INTEGER NOT NULL REFERENCES cricket_teams(id) ON DELETE CASCADE,
  overs INTEGER NOT NULL DEFAULT 6 CHECK (overs BETWEEN 1 AND 50),
  status VARCHAR(10) NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'finished')),
  toss_winner INTEGER,
  toss_choice VARCHAR(4),
  innings SMALLINT NOT NULL DEFAULT 1,
  bat_team INTEGER,
  target INTEGER,
  result VARCHAR(160),
  winner_id INTEGER,
  scorer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- a friend who scores in addition to the owner
  show_on_stream BOOLEAN NOT NULL DEFAULT FALSE,                -- when TRUE and the owner / scorer is live, the score bar is shown on the stream
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (team_a <> team_b)
);
CREATE INDEX IF NOT EXISTS cricket_m_t_idx ON cricket_matches (tournament_id, id);
CREATE INDEX IF NOT EXISTS cricket_m_status_idx ON cricket_matches (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS cricket_balls (
  id BIGSERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES cricket_matches(id) ON DELETE CASCADE,
  innings SMALLINT NOT NULL,
  striker_id INTEGER NOT NULL,
  non_striker_id INTEGER,
  bowler_id INTEGER NOT NULL,
  runs_bat SMALLINT NOT NULL DEFAULT 0,
  extra_type VARCHAR(2) CHECK (extra_type IN ('wd', 'nb', 'b', 'lb')),
  extra_runs SMALLINT NOT NULL DEFAULT 0,
  is_wicket BOOLEAN NOT NULL DEFAULT FALSE,
  wicket_type VARCHAR(12),
  out_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cricket_b_match_idx ON cricket_balls (match_id, innings, id);
CREATE INDEX IF NOT EXISTS cricket_b_striker_idx ON cricket_balls (striker_id);
CREATE INDEX IF NOT EXISTS cricket_b_bowler_idx ON cricket_balls (bowler_id);
