-- V51: Product dekh kar order na karne wale members ko yaad dihani (reminder)
ALTER TABLE product_visits ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS product_visits_remind_idx
  ON product_visits (user_id, created_at) WHERE user_id IS NOT NULL AND reminded_at IS NULL;
