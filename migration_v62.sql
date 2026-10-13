-- V62: Ludo look & sound preferences (theme, dice skin, token skin, sound on/off). Dobara chalane se koi nuqsan nahi.
-- Server start par ye file khud bhi chal jati hai (lib/ludo.js).
CREATE TABLE IF NOT EXISTS ludo_prefs (
  user_id     INTEGER      PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme       VARCHAR(12)  NOT NULL DEFAULT 'classic',
  dice_skin   VARCHAR(12)  NOT NULL DEFAULT 'classic',
  token_skin  VARCHAR(12)  NOT NULL DEFAULT 'round',
  sound       BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
