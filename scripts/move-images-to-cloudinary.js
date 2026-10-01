// Purani images (jo Neon database mein hain) Cloudinary par bhej deta hai aur database se data hata deta hai.
// Chalane se pehle migration_v12.sql chali hui ho aur .env mein DATABASE_URL + CLOUDINARY_URL ho.
//   node scripts/move-images-to-cloudinary.js          (sirf dekhe, kuch badle nahi)
//   node scripts/move-images-to-cloudinary.js --go     (asal mein move kare)
// /img/ID wale links wahi rehte hain, kuch tootta nahi. Dobara chalana safe hai.
const pool = require('../db');
const cloud = require('../lib/cloudinary');

(async () => {
  const go = process.argv.includes('--go');
  if (!cloud.enabled()) { console.error('Cloudinary settings nahi mili (CLOUDINARY_URL).'); process.exit(1); }
  const { rows } = await pool.query('SELECT id, mime, size FROM images WHERE remote_url IS NULL AND data IS NOT NULL ORDER BY id');
  const mb = rows.reduce((a, r) => a + r.size, 0) / 1048576;
  console.log(`${rows.length} images database mein hain (${mb.toFixed(1)} MB).`);
  if (!go) { console.log('Asal move ke liye --go lagayein.'); return pool.end(); }

  let ok = 0, bad = 0;
  for (const r of rows) {
    try {
      const { rows: [full] } = await pool.query('SELECT data FROM images WHERE id = $1', [r.id]);
      const { url } = await cloud.uploadImage(full.data, r.mime);
      // Pehle link save, tabhi data hatao: beech mein fail ho to image kabhi gum nahi hoti
      await pool.query('UPDATE images SET remote_url = $2, data = NULL WHERE id = $1', [r.id, url]);
      ok++; console.log('moved', r.id);
    } catch (e) { bad++; console.error('FAIL', r.id, e.message); }
  }
  console.log(`Done: ${ok} moved, ${bad} fail.`);
  console.log('Jagah wapas lene ke liye Neon SQL Editor mein chalayein:  VACUUM FULL images;');
  await pool.end();
})();
