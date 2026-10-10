// V56: Courier aur tracking number.
// Sirf wahi link "pakka" hain jo official tracking page ke hain (TCS, Leopards). In dono ka koi official
// "number ke saath seedha link" pattern confirm nahi hua, is liye customer ko official page par bheja jata hai
// aur number copy ho jata hai (page par paste karna hota hai).
// Kisi courier ka number-wala link aap ke paas ho to .env mein COURIER_TRACK_URLS likh dein, jaise:
//   COURIER_TRACK_URLS={"trax":"https://example.com/track?no={no}"}
// ({no} ki jagah tracking number lag jata hai; us courier ke liye "copy" ki zaroorat nahi rehti).

const COURIERS = [
  { key: 'tcs', name: 'TCS', page: 'https://www.tcsexpress.com/' },
  { key: 'leopards', name: 'Leopards', page: 'https://leopardscourier.com/leopards-tracking' },
  { key: 'mnp', name: 'M&P' },
  { key: 'trax', name: 'Trax' },
  { key: 'postex', name: 'PostEx' },
  { key: 'blueex', name: 'BlueEx' },
  { key: 'callcourier', name: 'Call Courier' },
  { key: 'pakpost', name: 'Pakistan Post' },
  { key: 'other', name: 'Doosra courier / rider' },
];

let overrides = {};
try { overrides = JSON.parse(process.env.COURIER_TRACK_URLS || '{}') || {}; } catch (e) { console.error('[couriers] COURIER_TRACK_URLS sahi JSON nahi:', e.message); }

const byKey = (k) => COURIERS.find((c) => c.key === k) || null;
const nameOf = (k) => (byKey(k) ? byKey(k).name : '');

// Tracking number: sirf huroof / hindsay / "-" (4 se 30)
function cleanTracking(v) {
  const s = String(v || '').replace(/\s+/g, '').slice(0, 40);
  return /^[A-Za-z0-9\-]{4,30}$/.test(s) ? s : null;
}

// { url, direct }: direct = true ho to link number ke saath seedha khulta hai (copy ki zaroorat nahi)
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
