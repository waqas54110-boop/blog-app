-- V36: Street Cricket - player photos for the live score bar. Run once in the Neon SQL Editor. Safe to run again.
-- (migration_v35.sql must have been run first.)
ALTER TABLE cricket_players ADD COLUMN IF NOT EXISTS photo_image_id INTEGER REFERENCES images(id) ON DELETE SET NULL;
