// V56: Courier and tracking number.
// Only the official tracking page links (TCS, Leopards) are considered reliable. No official
// "direct link with number" pattern has been confirmed for either, so the customer is sent to the official page
// and the number is copied (to be pasted on that page).
// If you have a number-based link for a courier, set COURIER_TRACK_URLS in .env, e.g.:
//   COURIER_TRACK_URLS={"trax":"https://example.com/track?no={no}"}
// ({no} is replaced by the tracking number; no "copy" is needed for that courier).

const COURIERS = [
  { key: 'tcs', name: 'TCS', page: 'https://www.tcsexpress.com/' },
  { key: 'leopards', name: 'Leopards', page: 'https://leopardscourier.com/leopards-tracking' },
  { key: 'mnp', name: 'M&P' },
  { key: 'trax', name: 'Trax' },
  { key: 'postex', name: 'PostEx' },
  { key: 'blueex', name: 'BlueEx' },
  { key: 'callcourier', name: 'Call Courier' },
  { key: 'pakpost', name: 'Pakistan Post' },
  { key: 'other', name: 'Other courier / rider' },
];

let overrides = {};
try { overrides = JSON.parse(process.env.COURIER_TRACK_URLS || '{}') || {}; } catch (e) { console.error('[couriers] COURIER_TRACK_URLS is not valid JSON:', e.message); }

const byKey = (k) => COURIERS.find((c) => c.key === k) || null;
const nameOf = (k) => (byKey(k) ? byKey(k).name : '');

// Tracking number: only letters / digits / "-" (4 to 30)
function cleanTracking(v) {
  const s = String(v || '').replace(/\s+/g, '').slice(0, 40);
  return /^[A-Za-z0-9\-]{4,30}$/.test(s) ? s : null;
}

// { url, direct }: direct = true means the link opens with the number applied (no copy needed)
function trackLink(courierKey, trackingNo) {
  const c = byKey(courierKey);
  if (!c) return null;
  const o = overrides[c.key];
  if (typeof o === 'string' && /^https:\/\//i.test(o)) {
    return o.includes('{no}')
      ? { url: o.replace('{no}', encodeURIComponent(trackingNo || '')), direct: true }
      : { url: o, direct: false };
  }
  return c.page ? { url: c.page, direct: false } : null;
}

module.exports = { COURIERS, byKey, nameOf, cleanTracking, trackLink };
