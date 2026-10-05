-- migration_v29.sql
-- V29: Creators ki kamayi (feed post ke views par) + manual withdraw (JazzCash / Easypaisa).
-- Neon SQL Editor mein ek baar run karein. Dobara run karna safe hai. Deploy se PEHLE run karein.
-- (migration_v19.sql aur migration_v10.sql pehle chal chuki hon: feed_posts.views aur users.email_verified chahiye.)

-- 1) Har feed post ke kitne views ka paisa ban chuka (views - credited_views = abhi tak na gina hua hissa)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'feed_posts' AND column_name = 'credited_views'
  ) THEN
    ALTER TABLE feed_posts ADD COLUMN credited_views INTEGER NOT NULL DEFAULT 0;
    -- Purane views ka paisa nahi milta, kamayi aaj se shuru. (Purane views ka bhi dena ho to agli line hata dein.)
    UPDATE feed_posts SET credited_views = views;
  END IF;
END $$;

-- 2) Har user ka wallet. Paisa (1 rupee = 100 paisa) mein, taake 100 views = Rs 1 bilkul seedha ginti ho
CREATE TABLE IF NOT EXISTS user_wallet (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_paisa      BIGINT NOT NULL DEFAULT 0 CHECK (balance_paisa >= 0),   -- abhi nikalne layak
  total_earned_paisa BIGINT NOT NULL DEFAULT 0,                               -- ab tak ki kul kamayi
  total_paid_paisa   BIGINT NOT NULL DEFAULT 0,                               -- jo aap bhej chuke
  cap_day            DATE,                                                    -- roz ki hadd ka din
  cap_paisa          BIGINT NOT NULL DEFAULT 0,                               -- us din ab tak kitna credit hua
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3) Withdraw requests (aap manually JazzCash / Easypaisa se bhejte hain, phir "Paid" dabate hain)
CREATE TABLE IF NOT EXISTS payout_requests (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_paisa   BIGINT NOT NULL CHECK (amount_paisa > 0),
  method         VARCHAR(10) NOT NULL CHECK (method IN ('jazzcash', 'easypaisa')),
  account_number VARCHAR(20) NOT NULL,
  account_name   VARCHAR(80) NOT NULL,
  status         VARCHAR(8) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected')),
  txn_ref        VARCHAR(60),      -- JazzCash / Easypaisa ki transaction ID (optional)
  admin_note     VARCHAR(200),     -- reject karne ki wajah
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at   TIMESTAMPTZ
);
-- Ek user ki ek waqt mein sirf ek pending request
CREATE UNIQUE INDEX IF NOT EXISTS payout_one_pending_uq ON payout_requests (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS payout_status_idx ON payout_requests (status, id DESC);
CREATE INDEX IF NOT EXISTS payout_user_idx ON payout_requests (user_id, id DESC);
