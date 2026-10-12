// Office devices (V58): scanner upload (/office/ingest) aur admin page (/admin/office).
//   ingestRouter  -> CSRF se PEHLE mount hota hai (scanner script browser nahi hai; token se pehchaan hoti hai)
//   adminRouter   -> CSRF ke BAAD (admin ke forms)
const express = require('express');
const L = require('../lib/office');
const M = require('../lib/officemon'); // V59 monitor

const ingestRouter = express.Router();
const adminRouter = express.Router();

const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('404', { code: 403, title: 'Not allowed', message: 'Only the blog owner can do this.' });
  }
  next();
};

const safe = (handler, json = false) => async (req, res, next) => {
  try { await handler(req, res, next); } catch (err) {
    console.error('[office]', err);
    if (err.code === '42P01') {
      const m = 'The office tables are not ready yet (run migration_v58.sql and migration_v59.sql).';
      return json ? res.status(503).json({ error: m }) : res.status(503).render('404', { code: 503, title: 'Office devices are being set up', message: m });
    }
    json ? res.status(500).json({ error: 'Server error' }) : res.status(500).send('Server error');
  }
};

// ---------- scanner -> site ----------
ingestRouter.post('/office/ingest', safe(async (req, res) => {
  if (!process.env.OFFICE_SCAN_TOKEN) return res.status(503).json({ error: 'Upload is off: set OFFICE_SCAN_TOKEN on the server (16+ characters).' });
  if (!L.tokenOk(req.get('authorization'))) return res.status(401).json({ error: 'Wrong token.' });
  const clean = L.cleanScan(req.body);
  if (clean.error) return res.status(400).json({ error: clean.error });
  const id = await L.saveScan(clean, 'upload');
  res.json({ ok: true, scan: id, devices: clean.devices.length });
}, true));

// ---------- monitor -> site: "abhi kaun kaun zinda hai" (har 5 minute; token se pehchaan, CSRF se pehle) ----------
ingestRouter.post('/office/heartbeat', safe(async (req, res) => {
  if (!process.env.OFFICE_SCAN_TOKEN) return res.status(503).json({ error: 'Upload is off: set OFFICE_SCAN_TOKEN on the server (16+ characters).' });
  if (!L.tokenOk(req.get('authorization'))) return res.status(401).json({ error: 'Wrong token.' });
  const beat = M.cleanBeat(req.body);
  if (beat.error) return res.status(400).json({ error: beat.error });
  const r = await M.processBeat(beat);
  res.json({ ok: true, ...r });
}, true));

// ---------- admin: file import (browser file ko JSON bana kar bhejta hai) ----------
adminRouter.post('/admin/office/import', requireAdmin, safe(async (req, res) => {
  const clean = L.cleanScan(req.body);
  if (clean.error) return res.status(400).json({ error: clean.error });
  const id = await L.saveScan(clean, 'import');
  res.json({ ok: true, scan: id, devices: clean.devices.length });
}, true));

// ---------- admin: main page ----------
const siteList = async () => (await require('../db').query(
  'SELECT site, count(*)::int AS scans, max(scanned_at) AS last_at FROM office_scans GROUP BY site ORDER BY max(scanned_at) DESC')).rows;

async function loadView(req) {
  const pool = require('../db');
  const sites = await siteList();
  let scanId = /^\d{1,9}$/.test(String(req.query.scan || '')) ? parseInt(req.query.scan, 10) : null;
  const site = String(req.query.site || '').slice(0, 80);
  if (!scanId) {
    const pick = site && sites.find((s) => s.site === site) ? site : sites[0] && sites[0].site;
    if (pick) {
      const r = await pool.query('SELECT id FROM office_scans WHERE site = $1 ORDER BY scanned_at DESC, id DESC LIMIT 1', [pick]);
      scanId = r.rows[0] && r.rows[0].id;
    }
  }
  const data = scanId ? await L.scanDevices(scanId) : null;
  if (!data) return { sites, data: null };
  const history = (await pool.query(
    'SELECT id, scanned_at, device_count, source FROM office_scans WHERE site = $1 ORDER BY scanned_at DESC, id DESC LIMIT 15', [data.scan.site])).rows;
  const cmp = await L.compareWithPrevious(data.scan, data.devices);
  let H = { monitor: null, status: new Map(), unknown: [], stats: new Map(), issues: [] };
  try { H = await M.healthData(data.scan.site); } catch (err) { if (err.code !== '42P01') throw err; } // migration_v59 na chali ho to baqi page chalta rahe
  const health = new Map(data.devices.map((d) => [d.key, M.healthOf(d, H.status.get(d.key), H.monitor)]));
  const risks = new Map(data.devices.map((d) => [d.key, M.risksFor(d)]));
  const riskList = [];
  data.devices.forEach((d) => (risks.get(d.key) || []).forEach((r) => riskList.push({ d, ...r })));
  const rank = { high: 0, medium: 1, info: 2 };
  riskList.sort((a, b) => rank[a.sev] - rank[b.sev]);
  // pichle 24 ghante: kis ne kitni baar drop kiya
  const report = data.devices
    .filter((d) => d.final_type !== 'phone' && H.stats.get(d.key) && (H.stats.get(d.key).drops > 0 || (H.stats.get(d.key).uptime !== null && H.stats.get(d.key).uptime < 99)))
    .map((d) => ({ d, s: H.stats.get(d.key) }))
    .sort((a, b) => b.s.drops - a.s.drops || (a.s.uptime || 0) - (b.s.uptime || 0));
  return { sites, data, history, cmp, counts: L.counts(data.devices), H, health, risks, riskList, report };
}

adminRouter.get('/admin/office', requireAdmin, safe(async (req, res) => {
  const v = await loadView(req);
  const typeFilter = L.TYPES.includes(req.query.type) ? req.query.type : '';
  const q = String(req.query.q || '').trim().slice(0, 60).toLowerCase();
  let shown = v.data ? v.data.devices : [];
  if (typeFilter) shown = shown.filter((d) => d.final_type === typeFilter);
  if (q) shown = shown.filter((d) => [d.ip, d.mac, d.vendor, d.final_name, d.location, d.note, d.hostname].join(' ').toLowerCase().includes(q));
  res.render('admin-office', {
    title: 'Office devices', robots: 'noindex,nofollow', L, ...v, shown, typeFilter, q,
    flash: req.query.ok || null, err: req.query.err || null, tokenSet: !!process.env.OFFICE_SCAN_TOKEN, alertsOn: M.alertsOn(),
  });
}));

// naam / qisam / jagah / note sahi karo
adminRouter.post('/admin/office/device', requireAdmin, safe(async (req, res) => {
  const site = L.oneLine(req.body.site, 80);
  const back = `/admin/office?scan=${/^\d{1,9}$/.test(req.body.scan || '') ? req.body.scan : ''}`;
  const ok = site && await L.saveAsset(site, String(req.body.key || ''), req.body);
  res.redirect(back + (ok ? '&ok=' + encodeURIComponent('Saved.') : '&err=' + encodeURIComponent('Could not save that device.')));
}));

// "Ye device mera hai": anjaan devices ki list se hata do
adminRouter.post('/admin/office/known', requireAdmin, safe(async (req, res) => {
  const site = L.oneLine(req.body.site, 80);
  const key = String(req.body.key || '');
  if (site && /^(mac:([0-9a-f]{2}:){5}[0-9a-f]{2}|ip:\d{1,3}(\.\d{1,3}){3})$/.test(key)) {
    await require('../db').query('UPDATE office_status SET marked_known = TRUE WHERE site = $1 AND dev_key = $2', [site, key]);
  }
  res.redirect('/admin/office?scan=' + (/^\d{1,9}$/.test(req.body.scan || '') ? req.body.scan : '') + '&ok=' + encodeURIComponent('Marked as known.'));
}));

adminRouter.post('/admin/office/test-alert', requireAdmin, safe(async (req, res) => {
  if (!M.alertsOn()) return res.redirect('/admin/office?err=' + encodeURIComponent('Alerts are off: set OFFICE_TELEGRAM_CHAT_ID (a private chat, not the public channel) and TELEGRAM_BOT_TOKEN on the server.'));
  const ok = await M.sendAlert('✅ Test message from the Khabzo office monitor. Alerts are working.');
  res.redirect('/admin/office?' + (ok ? 'ok=' + encodeURIComponent('Test message sent.') : 'err=' + encodeURIComponent('Telegram did not accept the message. Check the bot token and that the bot is allowed to message that chat.')));
}));

adminRouter.post('/admin/office/scan/:id/delete', requireAdmin, safe(async (req, res) => {
  const id = /^\d{1,9}$/.test(req.params.id) ? parseInt(req.params.id, 10) : 0;
  await require('../db').query('DELETE FROM office_scans WHERE id = $1', [id]);
  res.redirect('/admin/office?ok=' + encodeURIComponent('Scan deleted.'));
}));

// poori list CSV (Excel mein khulti hai)
adminRouter.get('/admin/office/export.csv', requireAdmin, safe(async (req, res) => {
  const id = /^\d{1,9}$/.test(String(req.query.scan || '')) ? parseInt(req.query.scan, 10) : 0;
  const data = await L.scanDevices(id);
  if (!data) return res.status(404).send('Scan not found');
  const cell = (v) => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // Excel formula injection se bachao
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const head = ['IP', 'MAC', 'Type', 'Name', 'Maker', 'Location', 'Note', 'Open ports'];
  const rows = data.devices.map((d) => [d.ip, d.mac, L.TYPE_ONE[d.final_type], d.final_name, d.vendor, d.location, d.note, (d.ports || []).join(' ')]);
  const csv = '\ufeff' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const day = new Date(data.scan.scanned_at).toISOString().slice(0, 10);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="office-devices-${day}.csv"` });
  res.send(csv);
}));

module.exports = { ingestRouter, adminRouter };
