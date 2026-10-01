// Cloudinary par image upload (koi nayi npm package nahi: Node 22 ka fetch + FormData).
// Settings (Render Environment): CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
// ya teen alag: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.
// Kuch set na ho to Cloudinary band rehti hai aur images pehle ki tarah database mein jati hain.
const crypto = require('crypto');

const FOLDER = process.env.CLOUDINARY_FOLDER || 'blog';

function creds() {
  const u = process.env.CLOUDINARY_URL;
  if (u) {
    const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(u.trim());
    if (m) return { key: m[1], secret: m[2], cloud: m[3] };
  }
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } = process.env;
  return cloud && key && secret ? { key, secret, cloud } : null;
}

const enabled = () => !!creds();

// Buffer upload karke { url } wapas deta hai (https). Masla ho to error throw karta hai.
async function uploadImage(buf, mime) {
  const c = creds();
  if (!c) throw new Error('Cloudinary not configured');
  const timestamp = Math.floor(Date.now() / 1000);
  // Signature: file/api_key ke ilawa sab params, a-z tarteeb se, phir secret
  const toSign = `folder=${FOLDER}&timestamp=${timestamp}`;
  const signature = crypto.createHash('sha1').update(toSign + c.secret).digest('hex');

  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), 'upload');
  form.append('api_key', c.key);
  form.append('timestamp', String(timestamp));
  form.append('folder', FOLDER);
  form.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(c.cloud)}/image/upload`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.secure_url) {
    throw new Error('Cloudinary: ' + ((j.error && j.error.message) || res.status));
  }
  return { url: j.secure_url };
}

// Dikhane ke liye: Cloudinary khud best format (WebP/AVIF) aur quality chunti hai, bandwidth bachti hai
function optimized(url) {
  return String(url).replace('/image/upload/', '/image/upload/f_auto,q_auto/');
}

// Image ke asli bytes (card banane ke liye): database se, warna Cloudinary se
async function loadImageBuffer(row) {
  if (row.data) return row.data;
  if (!row.remote_url) return null;
  const r = await fetch(row.remote_url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('image fetch ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

module.exports = { enabled, uploadImage, optimized, loadImageBuffer };
