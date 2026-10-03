-- migration_v20.sql
-- V20: Stories (24 ghante baad khatam), Groups (har group ki apni feed).
-- Neon SQL Editor mein ek baar run karein. Dobara run karna safe hai. Deploy se PEHLE run karein.
-- (migration_v18.sql pehle chal chuki ho: feed_posts aur images tables chahiye.)

-- 1) STORIES: chhoti text ya photo, 24 ghante baad khud khatam
CREATE TABLE IF NOT EXISTS stories (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       VARCHAR(300) NOT NULL DEFAULT '',
  image_id   INTEGER REFERENCES images(id) ON DELETE SET NULL,
  bg         SMALLINT NOT NULL DEFAULT 0,          -- text story ka background (0..5)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  CONSTRAINT stories_content_chk CHECK (body <> '' OR image_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS stories_expires_idx ON stories (expires_at);
CREATE INDEX IF NOT EXISTS stories_user_idx ON stories (user_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS stories_image_uq ON stories (image_id) WHERE image_id IS NOT NULL;

-- 2) STORY VIEWS: kis ne kaun si story dekhi (ring grey karne aur owner ko ginti dikhane ke liye)
CREATE TABLE IF NOT EXISTS story_views (
  story_id  INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id)
);
CREATE INDEX IF NOT EXISTS story_views_user_idx ON story_views (user_id);

-- 3) GROUPS
CREATE TABLE IF NOT EXISTS groups (
  id          SERIAL PRIMARY KEY,
  slug        VARCHAR(60) NOT NULL UNIQUE,
  name        VARCHAR(40) NOT NULL,
  description VARCHAR(300) NOT NULL DEFAULT '',
  emoji       VARCHAR(16) NOT NULL DEFAULT '👥',
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS groups_name_uq ON groups (lower(name));

CREATE TABLE IF NOT EXISTS group_members (
  group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      VARCHAR(10) NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id),
  CONSTRAINT group_members_role_chk CHECK (role IN ('admin', 'member'))
);
CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members (user_id);

-- 4) Group ki post = wahi feed_posts (like, comment, report, views sab pehle jaisa). group_id NULL = aam feed post
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS feed_posts_group_idx ON feed_posts (group_id, id DESC) WHERE group_id IS NOT NULL;

-- 5) Do shuruati groups (pehle admin account ke naam par). Admin na ho to kuch nahi banta, koi masla nahi.
INSERT INTO groups (slug, name, description, emoji, owner_id)
SELECT 'cricket', 'Cricket Talk', 'Matches, players, predictions and everything cricket.', '🏏', u.id
FROM users u WHERE u.role = 'admin' ORDER BY u.id LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO groups (slug, name, description, emoji, owner_id)
SELECT 'freelancing', 'Freelancing Hub', 'Clients, gigs, tools and tips for freelancers.', '💼', u.id
FROM users u WHERE u.role = 'admin' ORDER BY u.id LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO group_members (group_id, user_id, role)
SELECT g.id, g.owner_id, 'admin' FROM groups g WHERE g.slug IN ('cricket', 'freelancing')
ON CONFLICT DO NOTHING;
