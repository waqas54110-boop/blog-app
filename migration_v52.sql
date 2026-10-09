-- V52: Guest product watch (bina signup ke notification)
CREATE TABLE IF NOT EXISTS product_watch (
  id          SERIAL PRIMARY KEY,
  endpoint    TEXT NOT NULL,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ,
  UNIQUE (endpoint, product_id)
);
CREATE INDEX IF NOT EXISTS product_watch_due_idx ON product_watch (created_at) WHERE notified_at IS NULL;
