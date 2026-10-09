-- V50: Visit ke saath IP address aur shehar (kon aaya, kahan se aaya)
-- Blog post visits + shop product visits dono mein.
-- Safe: dobara chalane se kuch nahi bigarta.

ALTER TABLE post_visits    ADD COLUMN IF NOT EXISTS ip   VARCHAR(45);
ALTER TABLE post_visits    ADD COLUMN IF NOT EXISTS city VARCHAR(80);
ALTER TABLE product_visits ADD COLUMN IF NOT EXISTS ip   VARCHAR(45);
ALTER TABLE product_visits ADD COLUMN IF NOT EXISTS city VARCHAR(80);
ALTER TABLE product_visits ADD COLUMN IF NOT EXISTS country VARCHAR(2);
ALTER TABLE product_visits ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS post_visits_ip_idx    ON post_visits (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS product_visits_ip_idx ON product_visits (ip, created_at DESC);
