// Image ki row tabhi hatao jab wo kisi feed post, story ya profile photo se juri na ho
// aur (ownerId diya ho to) us owner ne hi upload ki ho.
const pool = require('../db');

async function dropIfOrphan(imageId, ownerId) {
  if (!imageId) return;
  await pool.query(
    `DELETE FROM images WHERE id = $1 AND ($2::int IS NULL OR uploaded_by = $2::int)
       AND NOT EXISTS (SELECT 1 FROM feed_posts WHERE image_id = $1)
       AND NOT EXISTS (SELECT 1 FROM stories WHERE image_id = $1)
       AND NOT EXISTS (SELECT 1 FROM users WHERE avatar_image_id = $1)`,
    [imageId, ownerId == null ? null : ownerId]
  );
}

// SQL ka tukda: image $N kisi aur cheez se juri na ho (naye post / story par istemal se pehle check)
const unusedSql = (param) =>
  `NOT EXISTS (SELECT 1 FROM feed_posts WHERE image_id = ${param})
   AND NOT EXISTS (SELECT 1 FROM stories WHERE image_id = ${param})
   AND NOT EXISTS (SELECT 1 FROM users WHERE avatar_image_id = ${param})`;

module.exports = { dropIfOrphan, unusedSql };
