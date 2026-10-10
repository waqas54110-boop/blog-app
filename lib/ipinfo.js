// ISP / VPN pehchan: har IP ek hi baar lookup hota hai, jawab ip_info table mein cache.
// Lookup request ke raste mein NAHI hota (page slow na ho): ek chhoti queue background mein chalati hai.
//
// .env (sab optional):
//   IPINFO_PROVIDER=ipapi   (default)  | off  -> sirf naam se andaza (guess)
//   IPAPI_KEY=...           ipapi.is ki key (na ho to free limit ~1000 lookups/din)
//   IPINFO_DAILY_MAX=800    ek din mein kitne lookups ki hadd
const pool = require('../db');

const PROVIDER = (process.env.IPINFO_PROVIDER || 'ipapi').toLowerCase();
const DAILY_MAX = parseInt(process.env.IPINFO_DAILY_MAX, 10) || 800;
const GAP_MS = 1300;           // do lookups ke beech
const MAX_QUEUE = 500;

// Naam se andaza (jab provider band ho ya fail ho jaye)
const VPN_NAMES = /nord|express ?vpn|surfshark|proton|mullvad|private internet|pia\b|cyberghost|windscribe|hotspot shield|tunnelbear|ipvanish|vyprvpn|m247|datacamp|choopa|packethub|quadranet|zenlayer/i;
const HOSTING_NAMES = /amazon|aws|google (cloud|llc)|microsoft (azure|corp)|digitalocean|ovh|hetzner|linode|akamai|vultr|contabo|leaseweb|cdn77|oracle|alibaba|tencent|cloudflare|colocrossing|scaleway|rackspace|online s\.a\.s|ionos|hostinger|namecheap|godaddy|railway|render|heroku|fly\.io|netlify|vercel/i;
const MOBILE_NAMES = /jazz|mobilink|warid|zong|cmpak|telenor|ufone|pakistan mobile|scom|onic|\bmobile\b|wireless|cellular|lte/i;

const isPrivate = (ip) =>
  !ip || /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(ip);

function guess(isp) {
  const n = String(isp || '');
  return {
    is_vpn: VPN_NAMES.test(n),
    is_proxy: false,
    is_tor: false,
    is_hosting: HOSTING_NAMES.test(n),
    is_mobile: MOBILE_NAMES.test(n),
  };
}

// ---------- provider: ipapi.is (VPN / proxy / datacenter / ASN / company) ----------
async function fromIpapi(ip) {
  const key = process.env.IPAPI_KEY ? '&key=' + encodeURIComponent(process.env.IPAPI_KEY) : '';
  const r = await fetch('https://api.ipapi.is/?q=' + encodeURIComponent(ip) + key, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error('ipapi http ' + r.status);
  const j = await r.json();
  if (!j || j.error) throw new Error('ipapi: ' + ((j && j.error) || 'empty'));
  const isp = (j.company && j.company.name) || (j.asn && (j.asn.org || j.asn.descr)) || null;
  const asnNum = j.asn && j.asn.asn ? 'AS' + String(j.asn.asn).replace(/^AS/i, '') : null;
  const g = guess(isp);
  return {
    asn: asnNum,
    isp: isp ? String(isp).slice(0, 120) : null,
    is_mobile: !!j.is_mobile || g.is_mobile,
    is_vpn: !!j.is_vpn,
    is_proxy: !!j.is_proxy,
    is_tor: !!j.is_tor,
    is_hosting: !!j.is_datacenter || (j.company && j.company.type === 'hosting') || (j.asn && j.asn.type === 'hosting'),
    source: 'ipapi',
  };
}

// ---------- queue ----------
const queue = [];
const seen = new Set();   // is process mein jo IP queue ho chuke (dobara na daalein)
let timer = null;
let day = '', used = 0;

async function save(ip, d) {
  await pool.query(
    `INSERT INTO ip_info (ip, asn, isp, is_mobile, is_vpn, is_proxy, is_tor, is_hosting, source, fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
     ON CONFLICT (ip) DO UPDATE SET asn=$2, isp=$3, is_mobile=$4, is_vpn=$5, is_proxy=$6, is_tor=$7, is_hosting=$8, source=$9, fetched_at=now()`,
    [ip, d.asn, d.isp, d.is_mobile, d.is_vpn, d.is_proxy, d.is_tor, d.is_hosting, d.source]
  );
}

async function work() {
  timer = null;
  const ip = queue.shift();
  if (!ip) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) { day = today; used = 0; }
    if (used >= DAILY_MAX) { queue.length = 0; seen.clear(); return; } // aaj ki hadd poori, kal phir
    used++;
    let d;
    try { d = await fromIpapi(ip); }
    catch (e) {
      console.error('[ipinfo]', ip, e.message);
      seen.delete(ip); // baad mein dobara koshish
      d = null;
    }
    if (d) await save(ip, d);
  } catch (e) {
    console.error('[ipinfo] save:', e.message);
  } finally {
    if (queue.length && !timer) timer = setTimeout(work, GAP_MS);
  }
}

// IP ko background lookup ke liye daalo (cache mein ho to kuch nahi karta)
async function enqueue(ip) {
  try {
    if (PROVIDER === 'off' || isPrivate(ip) || seen.has(ip) || queue.length >= MAX_QUEUE) return;
    if (day === new Date().toISOString().slice(0, 10) && used >= DAILY_MAX) return;
    seen.add(ip);
    if (seen.size > 5000) seen.clear();
    const hit = await pool.query('SELECT 1 FROM ip_info WHERE ip = $1 AND fetched_at > now() - interval \'90 days\'', [ip]);
    if (hit.rows.length) return;
    queue.push(ip);
    if (!timer) timer = setTimeout(work, 50);
  } catch (e) {
    if (e.code !== '42P01') console.error('[ipinfo] enqueue:', e.message); // 42P01 = migration_v55 baaqi
  }
}

// Purane visits ke jo IP abhi tak lookup nahi hue unko queue mein daalo (analytics page khulne par)
async function backfill(limit = 40) {
  try {
    const r = await pool.query(
      `SELECT v.ip FROM post_visits v LEFT JOIN ip_info i ON i.ip = v.ip
       WHERE v.ip IS NOT NULL AND i.ip IS NULL AND v.created_at > now() - interval '30 days'
       GROUP BY v.ip ORDER BY MAX(v.created_at) DESC LIMIT $1`, [limit]);
    for (const row of r.rows) await enqueue(row.ip);
    return r.rows.length;
  } catch (e) {
    if (e.code !== '42P01' && e.code !== '42703') console.error('[ipinfo] backfill:', e.message);
    return 0;
  }
}

module.exports = { enqueue, backfill, guess, isPrivate };
