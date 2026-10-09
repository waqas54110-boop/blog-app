// Product dekha magar order nahi kiya: login members ko yaad dihani (notification, chahein to email).
// Guest (bina signup) ko message nahi bhej sakte: unka koi contact (email / phone) hota hi nahi, sirf IP hoti hai.
// Isi liye product page par guest ko signup ka card dikhta hai (views/shop-product.ejs).
const pool = require('../db');
const { notifyUser } = require('./notify');

const WAIT_HOURS = parseInt(process.env.REMINDER_AFTER_HOURS, 10) || 2;   // dekhne ke itne ghante baad
const MAX_AGE_HOURS = 48;                                                  // 2 din se purani visit par nahi
const SEND_EMAIL = process.env.REMINDER_EMAIL === '1';                     // default: sirf in-app notification
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    // Har member ko ek tick mein ek reminder (uska sab se naya dekha hua product); 24 ghante mein ek se zyada nahi
    const due = (await pool.query(
      `SELECT DISTINCT ON (v.user_id) v.user_id, p.name, p.slug, s.slug AS shop_slug
       FROM product_visits v
       JOIN products p ON p.id = v.product_id AND p.is_active = true AND p.stock > 0
       JOIN shops s    ON s.id = v.shop_id AND s.status = 'active'
       WHERE v.user_id IS NOT NULL AND v.reminded_at IS NULL
         AND v.created_at < now() - ($1::int * interval '1 hour')
         AND v.created_at > now() - ($2::int * interval '1 hour')
         AND s.owner_id <> v.user_id
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = v.user_id AND o.product_id = v.product_id AND o.created_at > v.created_at)
         AND NOT EXISTS (SELECT 1 FROM product_visits r WHERE r.user_id = v.user_id AND r.reminded_at > now() - interval '24 hours')
       ORDER BY v.user_id, v.created_at DESC
       LIMIT 50`, [WAIT_HOURS, MAX_AGE_HOURS])).rows;

    for (const r of due) {
      // Pehle mark (dobara na jaye), phir bhejo
      await pool.query(
        `UPDATE product_visits SET reminded_at = now()
         WHERE user_id = $1 AND reminded_at IS NULL AND created_at < now() - ($2::int * interval '1 hour')`,
        [r.user_id, WAIT_HOURS]);
      const link = `/shop/${r.shop_slug}/${r.slug}?utm_source=reminder&utm_medium=notify`;
      await notifyUser(r.user_id, `Aap ne "${r.name}" dekha tha. Abhi stock mein hai, Cash on Delivery se order karein.`, link,
        { email: SEND_EMAIL, emailSubject: `"${r.name}" abhi available hai` });
    }
  } catch (err) {
    // 42703 = migration_v51 (reminded_at) abhi nahi chali: chup chap skip
    if (err.code !== '42703') console.error('[reminders] fail:', err.message);
  } finally {
    running = false;
  }
}

function startProductReminders() {
  setTimeout(tick, 40 * 1000);
  setInterval(tick, 10 * 60 * 1000).unref();
}

module.exports = { startProductReminders };
