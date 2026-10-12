// IP Checker (V57): a standalone tool. No database table, nothing else in the site depends on it.
//
// What it can really tell from an IP address:
//   - private / special address (Wi-Fi / LAN)  -> explained locally, no internet lookup
//   - public address -> country, city, ISP, mobile / home / server, VPN / proxy / Tor flags
// What NO website can tell from an IP address: the model or name of the laptop.
// (a public IP belongs to the router / SIM / VPN, not to one device)
//
// .env (all optional):
//   IPAPI_KEY=...            same ipapi.is key lib/ipinfo.js uses (free limit ~1000 lookups/day without a key)
//   IPCHECK_DAILY_MAX=400    max live lookups per day for this tool (cached repeats do not count)
//   IPCHECK_PROVIDER=off     no internet lookup at all (only private / special address checks work)
const net = require('net');
const dns = require('dns').promises;

const PROVIDER = (process.env.IPCHECK_PROVIDER || 'ipapi').toLowerCase();
const DAILY_MAX = parseInt(process.env.IPCHECK_DAILY_MAX, 10) || 400;
const CACHE_TTL = 60 * 60 * 1000;
const CACHE_MAX = 500;

// ---------- parsing ----------
function normalize(raw) {
  let s = String(raw || '').trim();
  if (!s) return { error: 'Please type an IP address.' };
  const m6 = s.match(/^\[([0-9a-f:.]+)\](?::\d+)?$/i);
  if (m6) s = m6[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(s)) s = s.replace(/:\d+$/, '');
  s = s.replace(/^::ffff:/i, '');
  if (s.length > 45 || !net.isIP(s)) {
    return { error: '"' + String(raw).trim().slice(0, 60) + '" is not a valid IP address. Example: 8.8.8.8 or 192.168.1.10' };
  }
  return { ip: s.toLowerCase(), version: net.isIP(s) };
}

// ---------- address type ----------
const v4num = (ip) => ip.split('.').reduce((a, b) => a * 256 + Number(b), 0);
const V4_RANGES = [
  ['0.0.0.0', 8, 'unspecified'], ['10.0.0.0', 8, 'private'], ['100.64.0.0', 10, 'cgnat'],
  ['127.0.0.0', 8, 'loopback'], ['169.254.0.0', 16, 'linklocal'], ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'reserved'], ['192.0.2.0', 24, 'documentation'], ['192.168.0.0', 16, 'private'],
  ['198.18.0.0', 15, 'reserved'], ['198.51.100.0', 24, 'documentation'], ['203.0.113.0', 24, 'documentation'],
  ['224.0.0.0', 4, 'multicast'], ['240.0.0.0', 4, 'reserved'],
];

function classify(ip) {
  if (net.isIP(ip) === 4) {
    const n = v4num(ip);
    for (const [base, bits, type] of V4_RANGES) {
      const b = v4num(base);
      if (n >= b && n < b + 2 ** (32 - bits)) return { type, v6: false };
    }
    return { type: 'public', v6: false };
  }
  const s = ip.toLowerCase();
  if (s === '::1') return { type: 'loopback', v6: true };
  if (s === '::') return { type: 'unspecified', v6: true };
  if (/^fe[89ab]/.test(s)) return { type: 'linklocal', v6: true };
  if (/^f[cd]/.test(s)) return { type: 'private', v6: true };
  if (/^ff/.test(s)) return { type: 'multicast', v6: true };
  if (/^2001:0?db8:/.test(s)) return { type: 'documentation', v6: true };
  return { type: 'public', v6: true };
}

const TYPE_LABEL = {
  public: 'Public internet address',
  private: 'Private address (Wi-Fi / LAN)',
  cgnat: 'Shared ISP address (CGNAT)',
  loopback: 'Loopback (this same computer)',
  linklocal: 'Link-local address',
  unspecified: 'Unassigned address',
  multicast: 'Multicast address',
  reserved: 'Reserved address',
  documentation: 'Documentation / example address',
};

// ---------- local (non-public) explanation + Wi-Fi advice ----------
const FIND_NAME = [
  'Open your router page (usually http://192.168.1.1 or http://192.168.0.1; the login is printed on the sticker under the router) and look for "Connected devices", "Client list" or "DHCP clients". It shows the name of each device (for example DESKTOP-AB12, Ali-iPhone, Galaxy-A52) with its IP and MAC address.',
  'On Windows, open Command Prompt and run: arp -a (shows IP + MAC). Then try: ping -a <ip>, it often prints the computer name.',
  'On the device itself: Windows > Settings > System > About (device name); Mac > System Settings > General > About; Android > Settings > About phone; iPhone > Settings > General > About.',
  'Copy the MAC address from the router list and paste it into "Find the maker from a MAC address" below. It tells the brand (Dell, Apple, Intel, Samsung, TP-Link...).',
  'Phones use a random MAC on Wi-Fi, so their brand shows as "random MAC". Turn off "Private Wi-Fi address" for your own network if you want the real one.',
];

const FIX_NO_IP = [
  'Turn Wi-Fi off and on again on the device (or turn Airplane mode on and off).',
  'Restart the router: unplug it for 30 seconds, plug it back in, wait 2 minutes.',
  'On the device choose "Forget this network" and join the Wi-Fi again.',
  'Windows: open Command Prompt as Administrator and run: ipconfig /release then ipconfig /renew.',
  'Open the router page > LAN / DHCP settings and make sure DHCP Server is ON and the address pool is not full (too many old devices).',
  'Test with a LAN cable. If the cable works, the problem is the Wi-Fi side of the router.',
  'Last option: set a manual IP on the device (for example 192.168.1.50, gateway 192.168.1.1, DNS 8.8.8.8) just to confirm the router is alive.',
];

function localAdvice(ip, kind) {
  const last = !kind.v6 ? Number(ip.split('.')[3]) : null;
  const A = { headline: '', what: '', status: 'ok', statusText: '', issues: [], fixes: [], findName: [] };
  switch (kind.type) {
    case 'private':
      A.headline = 'A private address inside a Wi-Fi / LAN network';
      A.what = 'Only devices inside the same network can reach this address, so it cannot be looked up on the internet (no country, no ISP). It is handed out by your router.';
      A.findName = FIND_NAME;
      A.statusText = 'The address itself looks normal. Nothing is wrong with it.';
      if (last === 1 || last === 254) A.issues.push('Addresses ending in .1 or .254 are very often the router itself (the gateway). Open it in the browser to see the router settings and the list of connected devices.');
      A.fixes = [
        'If two devices fight over the same address ("IP address conflict"), reserve a fixed address for each in the router (DHCP reservation / address binding).',
        'If the internet is slow or drops, use the "Test your own connection" box below on the affected device.',
      ];
      break;
    case 'cgnat':
      A.headline = 'A shared ISP address (CGNAT, 100.64.x.x)';
      A.what = 'Your ISP or mobile operator puts many customers behind one public IP. It is not a Wi-Fi router address and it is not tied to one device.';
      A.status = 'warn';
      A.statusText = 'Not a fault, but it limits what you can do.';
      A.issues = ['Port forwarding, CCTV / DVR remote viewing, hosting a game server and some VPNs will not work from behind CGNAT.'];
      A.fixes = ['Ask your ISP for a public (static) IP; many give one on request, sometimes for a small fee.', 'Or use a tunnel service (Cloudflare Tunnel, Tailscale) instead of port forwarding.'];
      break;
    case 'linklocal':
      if (kind.v6) {
        A.headline = 'IPv6 link-local address (fe80::)';
        A.what = 'Every IPv6 device creates this automatically. It only works inside the local network and is completely normal.';
        A.statusText = 'Normal. Nothing is wrong.';
        A.findName = FIND_NAME;
      } else {
        A.headline = 'A 169.254.x.x address: the device did NOT get an address from the router';
        A.what = 'When a device is connected to Wi-Fi / LAN but the router (DHCP server) does not answer, the device gives itself a 169.254.x.x address (APIPA). It looks connected, but there is no internet.';
        A.status = 'bad';
        A.statusText = 'Problem found: the device connected to the network but never received a proper IP address.';
        A.issues = ['Router DHCP is off, full or hung.', 'Weak Wi-Fi signal while connecting.', 'A bad LAN cable or a faulty port.'];
        A.fixes = FIX_NO_IP;
      }
      break;
    case 'loopback':
      A.headline = 'Loopback: this same computer talking to itself';
      A.what = '127.0.0.1 / ::1 always means "this device". It is used by programs that run on your own computer. It is not a Wi-Fi address and not another device.';
      A.statusText = 'Normal. If you expected a Wi-Fi address, run ipconfig (Windows) or ifconfig / ip a (Mac, Linux) and look for the Wi-Fi adapter instead.';
      break;
    case 'unspecified':
      A.headline = 'Unassigned address (0.0.0.0 / ::)';
      A.what = 'This means "no address". A device showing 0.0.0.0 is not connected to any network yet (or the Wi-Fi adapter is off).';
      A.status = 'bad';
      A.statusText = 'Problem found: the adapter has no address.';
      A.fixes = ['Make sure Wi-Fi is turned on and Airplane mode is off.', ...FIX_NO_IP.slice(1, 5)];
      break;
    case 'multicast':
      A.headline = 'Multicast address';
      A.what = 'Used to send one message to many devices at once (for example streaming or device discovery). It does not belong to one device.';
      A.statusText = 'Not a device address.';
      break;
    default:
      A.headline = kind.type === 'documentation' ? 'Documentation / example address' : 'Reserved address';
      A.what = 'This range is reserved (examples in tutorials, tests, special use). It never belongs to a real device on the internet.';
      A.statusText = 'Not a real device address.';
  }
  return A;
}

// ---------- public lookup ----------
// 1) ipapi.is (VPN / proxy / datacenter flags, same provider as lib/ipinfo.js)
// 2) ipwho.is (backup when ipapi.is is over its free limit or unreachable; VPN / server flags are then a guess from the ISP name)
const cache = new Map();
let usedDay = '';
let usedCount = 0;

const flag = (cc) => (/^[A-Za-z]{2}$/.test(cc || '') ? String.fromCodePoint(...cc.toUpperCase().split('').map((c) => 127397 + c.charCodeAt(0))) : '');

const VPN_NAMES = /nord|express ?vpn|surfshark|proton|mullvad|private internet|\bpia\b|cyberghost|windscribe|hotspot shield|tunnelbear|ipvanish|vyprvpn|m247|datacamp|choopa|packethub|quadranet|zenlayer/i;
const HOSTING_NAMES = /amazon|aws|google (cloud|llc)|microsoft (azure|corp)|digitalocean|ovh|hetzner|linode|akamai|vultr|contabo|leaseweb|cdn77|oracle|alibaba|tencent|cloudflare|colocrossing|scaleway|rackspace|online s\.a\.s|ionos|hostinger|namecheap|godaddy|railway|render|heroku|fly\.io|netlify|vercel|hosting|datacenter|data center|cloud|server/i;
const MOBILE_NAMES = /jazz|mobilink|warid|zong|cmpak|telenor|ufone|pakistan mobile|scom|onic|\bmobile\b|wireless|cellular|lte/i;

async function fromIpapi(ip) {
  const key = process.env.IPAPI_KEY ? '&key=' + encodeURIComponent(process.env.IPAPI_KEY) : '';
  const r = await fetch('https://api.ipapi.is/?q=' + encodeURIComponent(ip) + key, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('ipapi.is http ' + r.status);
  const j = await r.json();
  const loc = (j && j.location) || {};
  const asn = (j && j.asn) || {};
  const co = (j && j.company) || {};
  if (!j || j.error || !(asn.asn || co.name || loc.country)) throw new Error('ipapi.is: ' + ((j && j.error) ? String(j.error).slice(0, 80) : 'empty reply (free limit reached?)'));
  return {
    ok: true, source: 'ipapi.is',
    country: loc.country || null, countryCode: loc.country_code || null, flag: flag(loc.country_code),
    region: loc.state || null, city: loc.city || null, timezone: loc.timezone || null,
    isp: co.name || asn.org || null,
    asn: asn.asn ? 'AS' + String(asn.asn).replace(/^AS/i, '') : null,
    orgType: co.type || asn.type || null, domain: co.domain || asn.domain || null,
    isMobile: !!j.is_mobile || MOBILE_NAMES.test(co.name || asn.org || ''),
    isVpn: !!j.is_vpn, isProxy: !!j.is_proxy, isTor: !!j.is_tor,
    isDatacenter: !!j.is_datacenter, isAbuser: !!j.is_abuser,
    vpnService: (j.vpn && j.vpn.service) || null,
    datacenterName: (j.datacenter && j.datacenter.datacenter) || null,
    guessed: false,
  };
}

async function fromIpwho(ip) {
  const r = await fetch('https://ipwho.is/' + encodeURIComponent(ip), { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('ipwho.is http ' + r.status);
  const j = await r.json();
  if (!j || j.success === false) throw new Error('ipwho.is: ' + String((j && j.message) || 'failed').slice(0, 80));
  const c = j.connection || {};
  const isp = c.isp || c.org || null;
  const name = String(isp || '');
  return {
    ok: true, source: 'ipwho.is',
    country: j.country || null, countryCode: j.country_code || null, flag: flag(j.country_code),
    region: j.region || null, city: j.city || null, timezone: (j.timezone && j.timezone.id) || null,
    isp, asn: c.asn ? 'AS' + c.asn : null, orgType: null, domain: c.domain || null,
    isMobile: MOBILE_NAMES.test(name),
    isVpn: VPN_NAMES.test(name), isProxy: false, isTor: false,
    isDatacenter: HOSTING_NAMES.test(name), isAbuser: false,
    vpnService: null, datacenterName: null,
    guessed: true,
  };
}

async function lookup(ip) {
  if (PROVIDER === 'off') return { ok: false, reason: 'off' };
  const hit = cache.get(ip);
  if (hit && hit.exp > Date.now()) return hit.v;
  const today = new Date().toISOString().slice(0, 10);
  if (usedDay !== today) { usedDay = today; usedCount = 0; }
  if (usedCount >= DAILY_MAX) return { ok: false, reason: 'limit' };
  usedCount++;
  const errors = [];
  for (const fn of [fromIpapi, fromIpwho]) {
    try {
      const v = await fn(ip);
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(ip, { exp: Date.now() + CACHE_TTL, v });
      return v;
    } catch (e) {
      const msg = (e && e.cause && e.cause.code ? e.cause.code + ': ' : '') + (e && e.message ? e.message : String(e));
      errors.push(msg);
      console.error('ip-check lookup failed (' + fn.name + '):', msg);
    }
  }
  return { ok: false, reason: 'error', message: errors.join(' | ').slice(0, 260) };
}

async function reverse(ip) {
  try {
    const names = await Promise.race([dns.reverse(ip), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500))]);
    return names && names[0] ? String(names[0]).slice(0, 120) : null;
  } catch (e) { return null; }
}

// ---------- verdict ----------
function analyze(info, rdns) {
  const reasons = [];
  const rd = String(rdns || '').toLowerCase();
  const tor = info.isTor || /tor-exit|torexit|\.tor\./.test(rd);
  const vpn = info.isVpn || /(^|[.-])vpn([.-]|\d)/.test(rd);
  const proxy = info.isProxy;
  const server = info.isDatacenter || info.orgType === 'hosting';
  const mobile = info.isMobile;

  let real;
  if (tor) { real = { status: 'masked', label: 'Hidden: Tor exit node' }; reasons.push('This IP is a Tor exit node. The real person is hidden.'); }
  else if (vpn && info.guessed) { real = { status: 'masked', label: 'Likely hidden: VPN / proxy / server (guess)' }; reasons.push('The ISP name (' + (info.isp || 'unknown') + ') belongs to a company that runs VPN, proxy and hosting servers. This is a guess from the name only, not a confirmed VPN.'); }
  else if (vpn) { real = { status: 'masked', label: 'Hidden: VPN' }; reasons.push('This IP belongs to a VPN' + (info.vpnService ? ' (' + info.vpnService + ')' : '') + '. The real location of the person is hidden.'); }
  else if (proxy) { real = { status: 'masked', label: 'Hidden: proxy' }; reasons.push('This IP is a known proxy. The real location of the person may be different.'); }
  else if (server) { real = { status: 'server', label: 'A server, not a person at home' }; reasons.push('This IP belongs to a hosting / data-center company' + (info.datacenterName ? ' (' + info.datacenterName + ')' : '') + '. Websites, bots and many VPN / proxy services run from such IPs.'); }
  else { real = { status: 'real', label: 'Looks real (not known to be hidden)' }; reasons.push('Not listed as a VPN, proxy, Tor or data-center IP.'); }
  if (info.isAbuser) reasons.push('Warning: this IP was reported for abuse / spam before.');

  let connection;
  let device;
  if (server || tor || vpn || proxy) {
    connection = { icon: '🖥️', label: server ? 'Data-center / server' : 'Anonymizing service' };
    device = {
      headline: 'Not a laptop or phone. This is a server (or a VPN / proxy server).',
      lines: ['Many people can share this one address, so it says nothing about the real user\'s device.', 'The real device name cannot be found from this IP.'],
    };
  } else if (mobile) {
    connection = { icon: '📱', label: 'Mobile data (SIM / 4G / 5G)' };
    device = {
      headline: 'Most likely a phone, or a laptop using a phone hotspot / 4G-5G SIM router.',
      lines: ['Mobile operators put hundreds of customers behind one IP, so it is not tied to one device.', 'The exact phone or laptop model cannot be found from the IP.'],
    };
  } else {
    const kind = info.orgType === 'business' ? 'Business / office internet' : info.orgType === 'education' ? 'School / university network' : info.orgType === 'government' ? 'Government network' : 'Home / office broadband (Wi-Fi router)';
    connection = { icon: '🏠', label: kind };
    device = {
      headline: 'This is the address of the router / modem, not of one laptop.',
      lines: ['Every phone, laptop and TV behind that router shows this same public IP, so it cannot say which device it is or what the laptop is called.', 'To see the device names you must be inside that network (router page > connected devices).'],
    };
  }

  const dyn = /dynamic|dhcp|pool|ppp|dsl|dial|cable|adsl|dyn/.test(rd);
  const stat = /static|\bfix\b|business|leased/.test(rd);
  const notes = [];
  if (dyn) notes.push('The reverse DNS name looks dynamic, so this IP probably changes from time to time.');
  else if (stat) notes.push('The reverse DNS name looks static, so this IP is probably a fixed one.');
  if (info.orgType === 'education') notes.push('Many students share a school / university network.');
  if (info.guessed) notes.push('The backup lookup service was used, so the VPN / server / mobile result is a guess from the ISP name only. Try again later for the full check.');

  return { real, connection, device, reasons, notes };
}

// ---------- User-Agent of the visitor's own device ----------
function parseUA(ua) {
  const s = String(ua || '');
  let os = 'Unknown OS';
  let kind = 'Computer (laptop or desktop)';
  let model = null;
  if (/Android/i.test(s)) {
    os = 'Android';
    kind = /Mobile/i.test(s) ? 'Phone' : 'Tablet';
    const m = s.match(/Android[^;)]*;\s*([^;)]+?)(?:\s+Build|[;)])/i);
    if (m && m[1].trim().length > 1 && !/^mobile$/i.test(m[1].trim())) model = m[1].trim();
  } else if (/iPhone/.test(s)) { os = 'iOS'; kind = 'iPhone'; }
  else if (/iPad/.test(s)) { os = 'iPadOS'; kind = 'iPad'; }
  else if (/Windows NT/.test(s)) { os = 'Windows'; }
  else if (/CrOS/.test(s)) { os = 'ChromeOS'; kind = 'Chromebook'; }
  else if (/Mac OS X|Macintosh/.test(s)) { os = 'macOS'; kind = 'Mac (MacBook, iMac or Mac mini)'; }
  else if (/Linux/.test(s)) { os = 'Linux'; }
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\/|CriOS/.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Browser';
  return { os, kind, model, browser };
}

// ---------- main entry ----------
async function check(ip, { own = false, ua = '' } = {}) {
  const kind = classify(ip);
  const out = { ip, version: net.isIP(ip), kind, kindLabel: TYPE_LABEL[kind.type] || 'Address', own, ownDevice: own ? parseUA(ua) : null };
  if (kind.type !== 'public') {
    out.local = localAdvice(ip, kind);
    return out;
  }
  const [info, rdns] = await Promise.all([lookup(ip), reverse(ip)]);
  out.info = info;
  out.rdns = rdns;
  if (info.ok) out.verdict = analyze(info, rdns);
  return out;
}

// ---------- MAC address -> maker ----------
const macCache = new Map();
async function macVendor(raw) {
  const hex = String(raw || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (hex.length < 6) return { error: 'Type the MAC address like AA:BB:CC:DD:EE:FF (at least the first 6 characters).' };
  if (hex.length > 12 || /[^0-9a-f]/i.test(String(raw).replace(/[:.\-\s]/g, ''))) return { error: 'That does not look like a MAC address. Example: AA:BB:CC:DD:EE:FF' };
  const mac = (hex.match(/.{1,2}/g) || []).join(':');
  const firstByte = parseInt(hex.slice(0, 2), 16);
  if (firstByte & 2) {
    return { mac, random: true, vendor: null, note: 'This is a random (private) MAC address. Phones and newer laptops create one per Wi-Fi network to hide the brand, so the maker cannot be found. Turn off "Private Wi-Fi address" on that device for your own Wi-Fi to see the real one.' };
  }
  const oui = hex.slice(0, 6);
  if (macCache.has(oui)) return { mac, vendor: macCache.get(oui) };
  try {
    const r = await fetch('https://api.macvendors.com/' + encodeURIComponent(mac.slice(0, 8)), { signal: AbortSignal.timeout(5000) });
    if (r.status === 404) return { mac, vendor: null, note: 'No maker found for this MAC address.' };
    if (!r.ok) throw new Error('http ' + r.status);
    const vendor = String(await r.text()).trim().slice(0, 120);
    if (macCache.size >= 300) macCache.delete(macCache.keys().next().value);
    macCache.set(oui, vendor);
    return { mac, vendor };
  } catch (e) {
    return { mac, vendor: null, note: 'The maker lookup is busy right now. Please try again in a minute.' };
  }
}

module.exports = { normalize, classify, check, macVendor, parseUA, localAdvice, analyze, flag };
