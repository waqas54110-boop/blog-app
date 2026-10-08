-- V44: Facebook hook (share preview ka alag headline/description). Dobara chalane se koi nuqsan nahi.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS fb_title TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS fb_desc  TEXT;
