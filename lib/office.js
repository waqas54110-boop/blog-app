// Office devices (V58): scanner (scripts/office_scanner.py) ki list yahan save hoti hai aur admin page par
// ginti (kitne printer, laptop, camera...) aur poori list dikhti hai.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const pool = require('../db');

const TYPES = ['computer', 'printer', 'camera', 'phone', 'network', 'media', 'server', 'unknown'];
const TYPE_LABEL = { computer: 'Computers / laptops', printer: 'Printers', camera: 'Cameras', phone: 'Phones / tablets',
  network: 'Network (router, switch, Wi-Fi)', media: 'TV / media', server: 'Servers / NAS', unknown: 'Unknown' };
const TYPE_ONE = { computer: 'Computer', printer: 'Printer', camera: 'Camera', phone: 'Phone / tablet',
  network: 'Network device', media: 'TV / media', server: 'Server / NAS', unknown: 'Unknown' };
const TYPE_ICON = { computer: '💻', printer: '🖨️', camera: '📷', phone: '📱', network: '🌐', media: '📺', server: '🗄️', unknown: '❓' };
const MAX_DEVICES = 1100;

const oneLine = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

async function ensureSchema() {
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migration_v58.sql'), 'utf8'));
  } catch (err) {
    console.error('[office] migration_v58.sql did not run automatically (run it manually in the SQL editor):', err.message);
  }
}

// token ka muqabla (timing-safe). Token env mein OFFICE_SCAN_TOKEN; khali ho to upload band.
function tokenOk(header) {
  const want = process.env.OFFICE_SCAN_TOKEN || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(header || ''));
  if (!want || want.length < 16 || !m) return false;
  const a = crypto.createHash('sha256').update(m[1].trim()).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

const isPrivateV4 = (ip) => {
  if (!net.isIPv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};
const cleanMac = (v) => {
  const s = String(v || '').trim().toLowerCase();
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(s) ? s : null;
};

// Scanner se aaya JSON saaf karo: sirf private IPv4, qisam list mein se, lambai ki hadd. Galat device chhod do.
function cleanScan(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.devices)) return { error: 'This is not a scan file (no "devices" list).' };
  if (raw.devices.length > MAX_DEVICES) return { error: `Too many devices (max ${MAX_DEVICES}).` };
  const seen = new Set();
  const devices = [];
  for (const d of raw.devices) {
    if (!d || typeof d !== 'object') continue;
    const ip = String(d.ip || '').trim();
    if (!isPrivateV4(ip) || seen.has(ip)) continue;
    seen.add(ip);
    const ports = (Array.isArray(d.ports) ? d.ports : []).map(Number).filter((p) => Number.isInteger(p) && p > 0 && p < 65536).slice(0, 40);
    devices.push({
      ip, mac: cleanMac(d.mac), vendor: oneLine(d.vendor, 120) || null, hostname: oneLine(d.hostname, 120) || null,
      ports, web_title: oneLine(d.web_title, 100) || null, server: oneLine(d.server, 100) || null,
      type: TYPES.includes(d.type) ? d.type : 'unknown', label: oneLine(d.label, 160) || null,
      is_self: !!d.is_self, is_gateway: !!d.is_gateway, random_mac: !!d.random_mac,
    });
  }
  if (!devices.length) return { error: 'No valid private-network devices in this file.' };
  const when = new Date(raw.scanned_at);
  return {
    site: oneLine(raw.site, 80) || 'Office',
    subnet: oneLine(raw.subnet, 50) || null,
    scanner: oneLine(raw.scanner, 80) || null,
    scannedAt: Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 86400000 ? new Date() : when,
    devices,
  };
}

async function saveScan(clean, source) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(
      `INSERT INTO office_scans (site, subnet, scanner, scanned_at, device_count, source) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [clean.site, clean.subnet, clean.scanner, clean.scannedAt, clean.devices.length, source]);
    const id = rows[0].id;
    for (const d of clean.devices) {
      await c.query(
        `INSERT INTO office_devices (scan_id, ip, mac, vendor, hostname, ports, web_title, server, dev_type, label, is_self, is_gateway, random_mac)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, d.ip, d.mac, d.vendor, d.hostname, d.ports, d.web_title, d.server, d.type, d.label, d.is_self, d.is_gateway, d.random_mac]);
    }
    await c.query('COMMIT');
    // purane scans: har site ke sirf akhri 30 rakho
    await pool.query(
      `DELETE FROM office_scans WHERE site = $1 AND id NOT IN (SELECT id FROM office_scans WHERE site = $1 ORDER BY scanned_at DESC, id DESC LIMIT 30)`,
      [clean.site]).catch(() => {});
    return id;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

const devKey = (d) => (d.mac ? 'mac:' + d.mac : 'ip:' + d.ip);

// Scan ki devices + admin ki apni sahi ki hui jaankari (final_type / final_name)
async function scanDevices(scanId) {
  const { rows: sc } = await pool.query('SELECT * FROM office_scans WHERE id = $1', [scanId]);
  if (!sc[0]) return null;
  const scan = sc[0];
  const { rows } = await pool.query('SELECT * FROM office_devices WHERE scan_id = $1', [scanId]);
  const { rows: assets } = await pool.query('SELECT * FROM office_assets WHERE site = $1', [scan.site]);
  const byKey = new Map(assets.map((a) => [a.dev_key, a]));
  const devices = rows.map((d) => {
    const a = byKey.get(devKey(d)) || null;
    return {
      ...d, key: devKey(d), asset: a,
      final_type: a && a.dev_type && TYPES.includes(a.dev_type) ? a.dev_type : d.dev_type,
      final_name: (a && a.name) || d.label || d.hostname || d.ip,
      location: a ? a.location : null, note: a ? a.note : null, fixed: !!(a && (a.name || a.dev_type)),
    };
  }).sort((x, y) => {
    const ax = x.ip.split('.').map(Number), ay = y.ip.split('.').map(Number);
    for (let i = 0; i < 4; i++) if (ax[i] !== ay[i]) return ax[i] - ay[i];
    return 0;
  });
  return { scan, devices };
}

function counts(devices) {
  const out = {};
  TYPES.forEach((t) => { out[t] = 0; });
  devices.forEach((d) => { out[d.final_type] = (out[d.final_type] || 0) + 1; });
  return out;
}

// pichle scan se muqabla: kaun naya aaya, kaun gayab (MAC / IP se)
async function compareWithPrevious(scan, devices) {
  const { rows } = await pool.query(
    'SELECT id, scanned_at FROM office_scans WHERE site = $1 AND (scanned_at, id) < ($2, $3) ORDER BY scanned_at DESC, id DESC LIMIT 1',
    [scan.site, scan.scanned_at, scan.id]);
  if (!rows[0]) return null;
  const prev = await pool.query('SELECT ip, mac, label, hostname, dev_type FROM office_devices WHERE scan_id = $1', [rows[0].id]);
  const pk = new Map(prev.rows.map((d) => [devKey(d), d]));
  const ck = new Set(devices.map((d) => d.key));
  return {
    prevId: rows[0].id, prevAt: rows[0].scanned_at,
    added: devices.filter((d) => !pk.has(d.key)).map((d) => d.key),
    missing: prev.rows.filter((d) => !ck.has(devKey(d))).map((d) => ({ ip: d.ip, mac: d.mac, name: d.label || d.hostname || d.ip, type: d.dev_type })),
  };
}

async function saveAsset(site, key, { name, type, location, note }) {
  if (!/^(mac:([0-9a-f]{2}:){5}[0-9a-f]{2}|ip:\d{1,3}(\.\d{1,3}){3})$/.test(key)) return false;
  const n = oneLine(name, 120) || null, t = TYPES.includes(type) ? type : null, l = oneLine(location, 80) || null, o = oneLine(note, 300) || null;
  if (!n && !t && !l && !o) {
    await pool.query('DELETE FROM office_assets WHERE site = $1 AND dev_key = $2', [site, key]);
    return true;
  }
  await pool.query(
    `INSERT INTO office_assets (site, dev_key, name, dev_type, location, note, updated_at) VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (site, dev_key) DO UPDATE SET name = $3, dev_type = $4, location = $5, note = $6, updated_at = now()`,
    [site, key, n, t, l, o]);
  return true;
}

module.exports = { TYPES, TYPE_LABEL, TYPE_ONE, TYPE_ICON, ensureSchema, tokenOk, cleanScan, saveScan, scanDevices, counts,
  compareWithPrevious, saveAsset, oneLine };
