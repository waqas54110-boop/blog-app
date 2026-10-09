-- V46: Shop (multi-vendor). Har user apni shop khol sakta hai: products, orders, group-wise sales analytics.
-- Dobara chalane se koi nuqsan nahi (IF NOT EXISTS). Server start par ye file khud bhi chal jati hai.

-- 1) Shops (ek user ki ek shop)
CREATE TABLE IF NOT EXISTS shops (
  id               SERIAL       PRIMARY KEY,
  owner_id         INTEGER      NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  slug             VARCHAR(60)  NOT NULL UNIQUE,
  name             VARCHAR(80)  NOT NULL,
  tagline          VARCHAR(140),
  description      TEXT,
  city             VARCHAR(60),
  whatsapp         VARCHAR(20),                       -- 923001234567 (orders yahan aate hain)
  phone            VARCHAR(20),
  logo_image_id    INTEGER      REFERENCES images(id) ON DELETE SET NULL,
  cod_enabled      BOOLEAN      NOT NULL DEFAULT true,
  wa_enabled       BOOLEAN      NOT NULL DEFAULT true,
  delivery_fee_rs  INTEGER      NOT NULL DEFAULT 0,
  free_over_rs     INTEGER,                            -- itne se upar delivery free (khali = nahi)
  status           VARCHAR(12)  NOT NULL DEFAULT 'active',  -- pending | active | suspended
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 2) Products
CREATE TABLE IF NOT EXISTS products (
  id               SERIAL       PRIMARY KEY,
  shop_id          INTEGER      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  slug             VARCHAR(90)  NOT NULL,
  name             VARCHAR(120) NOT NULL,
  category         VARCHAR(40),
  description      TEXT,
  price_rs         INTEGER      NOT NULL CHECK (price_rs >= 0),
  compare_price_rs INTEGER,                            -- purani (kati hui) qeemat, optional
  stock            INTEGER      NOT NULL DEFAULT 0 CHECK (stock >= 0),  -- 0 = Sold out
  is_active        BOOLEAN      NOT NULL DEFAULT true, -- false = chhupa hua
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (shop_id, slug)
);
CREATE INDEX IF NOT EXISTS products_shop_idx ON products (shop_id, is_active);

-- 3) Product photos (position 0 = main photo)
CREATE TABLE IF NOT EXISTS product_images (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_id   INTEGER NOT NULL REFERENCES images(id)   ON DELETE CASCADE,
  position   SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, image_id)
);
CREATE INDEX IF NOT EXISTS product_images_img_idx ON product_images (image_id);

-- 4) Orders (Cash on Delivery / WhatsApp)
CREATE TABLE IF NOT EXISTS orders (
  id             SERIAL       PRIMARY KEY,
  token          VARCHAR(24)  NOT NULL UNIQUE,           -- customer ka thank-you page link
  shop_id        INTEGER      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id     INTEGER      REFERENCES products(id) ON DELETE SET NULL,
  product_name   VARCHAR(120) NOT NULL,                  -- order ke waqt ka naam / qeemat (baad mein badle to bhi yahi rahe)
  unit_price_rs  INTEGER      NOT NULL,
  qty            INTEGER      NOT NULL CHECK (qty > 0),
  delivery_rs    INTEGER      NOT NULL DEFAULT 0,
  total_rs       INTEGER      NOT NULL,
  customer_name  VARCHAR(80)  NOT NULL,
  phone          VARCHAR(20)  NOT NULL,
  city           VARCHAR(60)  NOT NULL,
  address        VARCHAR(300) NOT NULL,
  note           VARCHAR(300),
  payment_method VARCHAR(10)  NOT NULL DEFAULT 'cod',    -- cod | whatsapp
  status         VARCHAR(12)  NOT NULL DEFAULT 'new',    -- new | shipped | delivered | returned
  restocked      BOOLEAN      NOT NULL DEFAULT false,    -- "Wapas" par stock ek hi baar wapas judta hai
  user_id        INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  source         VARCHAR(40),
  medium         VARCHAR(40),
  campaign       VARCHAR(60),                            -- group ka UTM (group-wise sales yahan se)
  visitor        VARCHAR(40),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_shop_idx     ON orders (shop_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_campaign_idx ON orders (campaign) WHERE campaign IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_phone_idx    ON orders (phone, created_at DESC);

-- 5) Product page visits (kis group / source se kitne log aaye)
CREATE TABLE IF NOT EXISTS product_visits (
  id         BIGSERIAL    PRIMARY KEY,
  product_id INTEGER      NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  shop_id    INTEGER      NOT NULL REFERENCES shops(id)    ON DELETE CASCADE,
  source     VARCHAR(40),
  medium     VARCHAR(40),
  campaign   VARCHAR(60),
  referrer   VARCHAR(255),
  visitor    VARCHAR(40),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_visits_shop_idx     ON product_visits (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS product_visits_campaign_idx ON product_visits (campaign) WHERE campaign IS NOT NULL;

-- 6) Shop ke groups (WhatsApp / Facebook ...), har group ka apna UTM
CREATE TABLE IF NOT EXISTS shop_groups (
  id         SERIAL       PRIMARY KEY,
  shop_id    INTEGER      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name       VARCHAR(80)  NOT NULL,
  platform   VARCHAR(20)  NOT NULL DEFAULT 'whatsapp',
  link       VARCHAR(500),
  utm        VARCHAR(60)  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (shop_id, utm)
);

-- 7) "Aaj is product ko is group mein post kar diya" (✓)
CREATE TABLE IF NOT EXISTS shop_group_posted (
  group_id   INTEGER NOT NULL REFERENCES shop_groups(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id)    ON DELETE CASCADE,
  posted_on  DATE    NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, product_id, posted_on)
);

-- 8) Blog post ke neeche "Ye product kharido" card
ALTER TABLE posts ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;
