-- migration_v4.sql
-- Naye features: SEO slugs, image upload (database mein), password reset tokens.
-- Neon SQL Editor mein ek baar run karein. Dobara run karna bhi safe hai.

-- 1) Slugs: /posts/12  ->  /posts/my-post-title
ALTER TABLE posts ADD COLUMN IF NOT EXISTS slug VARCHAR(120);

WITH base AS (
  SELECT id,
         CASE
           WHEN s = '' THEN 'post'
           WHEN s ~ '^[0-9]+$' THEN 'post-' || s   -- sirf number wala slug id se takra jata
           ELSE s
         END AS s
  FROM (
    SELECT id,
           trim(both '-' from left(trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g')), 80)) AS s
    FROM posts WHERE slug IS NULL
  ) t
), ranked AS (
  SELECT id, s, row_number() OVER (PARTITION BY s ORDER BY id) AS rn FROM base
)
UPDATE posts p
SET slug = CASE WHEN r.rn = 1 THEN r.s ELSE r.s || '-' || p.id END
FROM ranked r
WHERE p.id = r.id;

ALTER TABLE posts ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS posts_slug_idx ON posts (slug);

-- 2) Uploaded images (cover + post ke andar ki images)
CREATE TABLE IF NOT EXISTS images (
  id          SERIAL PRIMARY KEY,
  mime        VARCHAR(30) NOT NULL,
  data        BYTEA NOT NULL,
  size        INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3) Password reset tokens (token ka sirf hash store hota hai)
CREATE TABLE IF NOT EXISTS password_resets (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id);
