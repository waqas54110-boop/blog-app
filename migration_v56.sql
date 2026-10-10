-- V56: Shop ke 6 naye features
--   1) Product variants (rang / size / qisam)       2) Coupon codes
--   3) Cart (ek order mein kai cheezein)            4) Order ke baad WhatsApp message (log)
--   5) Courier + tracking number                    6) Social proof (asli ginti ke liye index)
-- Dobara chalane se koi nuqsan nahi (IF NOT EXISTS). Server start par ye file khud bhi chal jati hai.

-- 1) Variants. Har variant ka apna stock; price khali ho to product ki price lagti hai.
--    Variant wale product ka products.stock = uske variants ke stock ka jama (code khud sync rakhta hai).
CREATE TABLE IF NOT EXISTS product_variants (
  id         SERIAL      PRIMARY KEY,
  product_id INTEGER     NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color      VARCHAR(30),
  size       VARCHAR(30),
  kind       VARCHAR(30),
  price_rs   INTEGER     CHECK (price_rs IS NULL OR price_rs >= 0),
  stock      INTEGER     NOT NULL DEFAULT 0 CHECK (stock >= 0),
  position   SMALLINT    NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_variants_product_idx ON product_variants (product_id, position);

-- 2) Coupons (har shop ke apne). code hamesha BADE huroof mein save hota hai.
CREATE TABLE IF NOT EXISTS coupons (
  id           SERIAL      PRIMARY KEY,
  shop_id      INTEGER     NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  code         VARCHAR(30) NOT NULL,
  kind         VARCHAR(8)  NOT NULL DEFAULT 'percent',      -- percent | flat
  value        INTEGER     NOT NULL CHECK (value > 0),
  min_order_rs INTEGER     NOT NULL DEFAULT 0,
  max_uses     INTEGER,                                      -- khali = bepanah
  used_count   INTEGER     NOT NULL DEFAULT 0,
  only_source  VARCHAR(40),                                  -- jaise tiktok: sirf us source se aane walon ke liye
  expires_at   TIMESTAMPTZ,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, code)
);

-- 3) Orders ke naye columns: coupon, discount, courier, tracking
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id   INTEGER REFERENCES coupons(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(30);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_rs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier     VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_no VARCHAR(40);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at  TIMESTAMPTZ;

-- 4) Order ki cheezein (ek order mein kai). Naam / qeemat order ke waqt ki save rehti hai.
CREATE TABLE IF NOT EXISTS order_items (
  id            SERIAL       PRIMARY KEY,
  order_id      INTEGER      NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    INTEGER      REFERENCES products(id) ON DELETE SET NULL,
  variant_id    INTEGER      REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name  VARCHAR(120) NOT NULL,
  variant_label VARCHAR(100),
  unit_price_rs INTEGER      NOT NULL,
  qty           INTEGER      NOT NULL CHECK (qty > 0)
);
CREATE INDEX IF NOT EXISTS order_items_order_idx   ON order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_product_idx ON order_items (product_id, order_id);

-- Purane (ek product wale) orders ko bhi order_items mein le aao, taake sab jagah ek hi tareeqa chale
INSERT INTO order_items (order_id, product_id, product_name, unit_price_rs, qty)
SELECT o.id, o.product_id, o.product_name, o.unit_price_rs, o.qty
FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id);

-- 5) Customer ko kaunsa WhatsApp message gaya (har order ka har kism ka sirf ek)
CREATE TABLE IF NOT EXISTS order_messages (
  id         SERIAL      PRIMARY KEY,
  order_id   INTEGER     NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind       VARCHAR(12) NOT NULL,                           -- placed | dispatched | tracking
  channel    VARCHAR(12) NOT NULL DEFAULT 'whatsapp',
  status     VARCHAR(10) NOT NULL DEFAULT 'pending',         -- pending | sent | failed | skipped
  error      VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, kind)
);

-- 6) Social proof: "aaj kitne logon ne dekha" tez nikalne ke liye
CREATE INDEX IF NOT EXISTS product_visits_product_idx ON product_visits (product_id, created_at DESC);
