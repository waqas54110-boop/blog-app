// Office monitor (V59): scanner ka --monitor har 5 minute "heartbeat" bhejta hai (kaun kaun zinda hai).
// Yahan: online/slow/offline ka haal, 24 ghante ki report, IP masle, open-port warnings aur Telegram alerts.
const net = require('net');
const pool = require('../db');
const config = require('../config');
const L = require('./office');

const ALERT_TYPES = new Set(['printer', 'camera', 'server', 'network']); // inke band hone par message (computer/phone raat ko band hote hain)
const DOWN_AFTER = 2;      // lagatar itni heartbeats mein nazar na aaye tab offline alert (2 x 5 min = ~10 min)
const SLOW_MS = 150;       // is se zyada ping = "slow"
const MAX_DEVICES = 1100;
const MAX_ALERT_LINES = 12;

// ---------------------------------------------------------------- Telegram (private chat; public channel par kabhi nahi)
const alertChat = () => String(process.env.OFFICE_TELEGRAM_CHAT_ID || '').trim();
const alertsOn = () => !!(config.telegramToken && alertChat() && alertChat() !== String(config.telegramChat || ''));

async function sendAlert(text) {
  if (!alertsOn()) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: alertChat(), text: String(text).slice(0, 3500), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) console.error('[officemon] Telegram refused the message:', res.status, data.description || '');
    return !!data.ok;
  } catch (err) {
    console.error('[officemon] Telegram error:', String(err.message).split(config.telegramToken).join('***'));
    return false;
  }
}

async function sendAlerts(site, lines) {
  if (!lines.length) return;
  const shown = lines.slice(0, MAX_ALERT_LINES);
  if (lines.length > shown.length) shown.push(`...and ${lines.length - shown.length} more (see the Office devices page).`);
  await sendAlert(`🏢 ${site}\n` + shown.join('\n'));
}

const dur = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return m + ' min';
  if (m < 2880) return Math.round(m / 60) + ' h';
  return Math.round(m / 1440) + ' days';
};

// ---------------------------------------------------------------- heartbeat saaf karo
function cleanBeat(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.devices)) return { error: 'This is not a heartbeat (no "devices" list).' };
  const site = L.oneLine(raw.site, 80);
  if (!site) return { error: 'Missing "site".' };
  if (raw.devices.length > MAX_DEVICES) return { error: `Too many devices (max ${MAX_DEVICES}).` };
  const seen = new Set();
  const devices = [];
  for (const d of raw.devices) {
    if (!d || typeof d !== 'object') continue;
    const ip = String(d.ip || '').trim();
    if (!L.isPrivateV4(ip) || seen.has(ip)) continue;
    seen.add(ip);
    const rtt = Number(d.rtt);
    devices.push({
      ip, mac: L.cleanMac(d.mac), self: !!d.self,
      rtt: Number.isFinite(rtt) && rtt >= 0 && rtt < 60000 ? Math.round(rtt * 10) / 10 : null,
      vendor: L.oneLine(d.vendor, 120) || null, name: L.oneLine(d.name, 120) || null,
    });
  }
  // koi bhi na mile to scanner computer ka apna network gira hua hai: poore office ko offline na likho
  if (!devices.length) return { error: 'No devices in this heartbeat (scanner computer may be off the network).' };
  const link_local = (Array.isArray(raw.link_local) ? raw.link_local : []).slice(0, 50)
    .map((x) => ({ ip: String((x && x.ip) || '').trim(), mac: L.cleanMac(x && x.mac) }))
    .filter((x) => net.isIPv4(x.ip) && x.ip.startsWith('169.254.'));
  let dhcp = null;
  if (raw.dhcp && typeof raw.dhcp === 'object') {
    dhcp = {
      ran: !!raw.dhcp.ran,
      servers: [...new Set((Array.isArray(raw.dhcp.servers) ? raw.dhcp.servers : []).map((s) => String(s).trim()).filter((s) => net.isIPv4(s)))].slice(0, 10),
      error: L.oneLine(raw.dhcp.error, 120) || null,
    };
  }
  const iv = parseInt(raw.interval, 10);
  return {
    site, devices, link_local, dhcp,
    host: L.oneLine(raw.host, 80) || null,
    subnet: L.oneLine(raw.subnet, 50) || null,
    gateway: net.isIPv4(String(raw.gateway || '')) ? String(raw.gateway) : null,
    interval: Number.isInteger(iv) ? Math.min(3600, Math.max(60, iv)) : 300,
  };
}

// ---------------------------------------------------------------- masle (issues)
async function upsertIssue(site, kind, ikey, detail) {
  const prev = await pool.query('SELECT active FROM office_issues WHERE site = $1 AND kind = $2 AND ikey = $3', [site, kind, ikey]);
  await pool.query(
    `INSERT INTO office_issues (site, kind, ikey, detail) VALUES ($1,$2,$3,$4)
     ON CONFLICT (site, kind, ikey) DO UPDATE SET detail = $4, last_seen = now(), active = TRUE,
       first_seen = CASE WHEN office_issues.active THEN office_issues.first_seen ELSE now() END`,
    [site, kind, ikey, detail.slice(0, 400)]);
  return !(prev.rows[0] && prev.rows[0].active); // true = naya (ya dobara aaya) masla
}

const resolveIssues = (site, kind, activeKeys) => pool.query(
  'UPDATE office_issues SET active = FALSE WHERE site = $1 AND kind = $2 AND active AND NOT (ikey = ANY($3::text[]))', [site, kind, activeKeys]);

// ---------------------------------------------------------------- status likhna
async function writeStatus(site, r, inScan) {
  if (!r.keys.length) return;
  await pool.query(
    `INSERT INTO office_status (site, dev_key, ip, mac, vendor, name, last_seen, online, rtt_ms, fail_count, since, in_scan, alerted_down, alerted_new)
     SELECT $1::text, t.k, t.c_ip, t.c_mac, t.c_vendor, t.c_name, CASE WHEN t.c_online THEN now() END, t.c_online, t.c_rtt, t.c_fail, t.c_since, $2::boolean, t.c_down, TRUE
     FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::boolean[], $9::real[], $10::int[], $11::timestamptz[], $12::boolean[])
          AS t(k, c_ip, c_mac, c_vendor, c_name, c_online, c_rtt, c_fail, c_since, c_down)
     ON CONFLICT (site, dev_key) DO UPDATE SET
       ip = EXCLUDED.ip, mac = COALESCE(EXCLUDED.mac, office_status.mac),
       vendor = COALESCE(EXCLUDED.vendor, office_status.vendor), name = COALESCE(EXCLUDED.name, office_status.name),
       last_seen = CASE WHEN EXCLUDED.online THEN now() ELSE office_status.last_seen END,
       online = EXCLUDED.online, rtt_ms = EXCLUDED.rtt_ms, fail_count = EXCLUDED.fail_count, since = EXCLUDED.since,
       in_scan = EXCLUDED.in_scan, alerted_down = EXCLUDED.alerted_down`,
    [site, inScan, r.keys, r.ips, r.macs, r.vendors, r.names, r.online, r.rtt, r.fail, r.since, r.down]);
}

const newRows = () => ({ keys: [], ips: [], macs: [], vendors: [], names: [], online: [], rtt: [], fail: [], since: [], down: [] });
function pushRow(r, o) {
  r.keys.push(o.key); r.ips.push(o.ip); r.macs.push(o.mac || null); r.vendors.push(o.vendor || null); r.names.push(o.name || null);
  r.online.push(o.online); r.rtt.push(o.rtt == null ? null : o.rtt); r.fail.push(o.fail); r.since.push(o.since.toISOString()); r.down.push(!!o.down);
}

// ---------------------------------------------------------------- ek heartbeat ka poora kaam
async function processBeat(beat) {
  const q = (t, p) => pool.query(t, p);
  const site = beat.site;
  const now = new Date();
  const alerts = [];

  const prevMon = (await q('SELECT * FROM office_monitor WHERE site = $1', [site])).rows[0] || null;
  const firstBeat = !prevMon; // pehli baar: jo bhi dikhe usko "naya" ya "band" na kaho
  const sc = (await q('SELECT id FROM office_scans WHERE site = $1 ORDER BY scanned_at DESC, id DESC LIMIT 1', [site])).rows[0];
  const data = sc ? await L.scanDevices(sc.id) : null;
  const devices = data ? data.devices : [];
  const old = new Map((await q('SELECT * FROM office_status WHERE site = $1', [site])).rows.map((r) => [r.dev_key, r]));

  await q(
    `INSERT INTO office_monitor (site, last_beat, host, subnet, gateway, interval_s, dhcp, silent_alerted)
     VALUES ($1, now(), $2, $3, $4, $5, $6::jsonb, FALSE)
     ON CONFLICT (site) DO UPDATE SET last_beat = now(), host = $2, subnet = $3, gateway = $4, interval_s = $5,
       dhcp = COALESCE($6::jsonb, office_monitor.dhcp), silent_alerted = FALSE`,
    [site, beat.host, beat.subnet, beat.gateway, beat.interval, beat.dhcp ? JSON.stringify(beat.dhcp) : null]);
  if (prevMon && prevMon.silent_alerted) alerts.push(`✅ The office monitor is back (reports from ${beat.host || 'the monitor computer'}).`);

  const byMac = new Map();
  const byIp = new Map();
  for (const b of beat.devices) { if (b.mac) byMac.set(b.mac, b); byIp.set(b.ip, b); }
  const used = new Set();

  // --- 1) scan wali devices: online/offline
  const scanRows = newRows();
  const pk = [], pu = [], pr = [];
  let onlineN = 0;
  for (const d of devices) {
    let b = d.mac ? byMac.get(d.mac) : null;
    if (!b) { const x = byIp.get(d.ip); if (x && (!x.mac || !d.mac)) b = x; } // IP par koi aur MAC baitha ho to wo ye device nahi
    if (b) used.add(b);
    const up = !!b;
    if (up) onlineN++;
    const o = old.get(d.key);
    const fail = up ? 0 : (o ? o.fail_count + 1 : 1);
    const since = !o || o.online !== up ? now : new Date(o.since);
    let down = o ? o.alerted_down : false;
    const who = `${d.final_name} (${d.ip})${d.location ? ', ' + d.location : ''}`;
    if (!up && !firstBeat && ALERT_TYPES.has(d.final_type) && fail >= DOWN_AFTER && !down) {
      down = true;
      alerts.push(`🔴 ${L.TYPE_ONE[d.final_type]} is OFFLINE: ${who}`);
    } else if (up && down) {
      down = false;
      alerts.push(`🟢 Back online: ${who}` + (o ? ` (was down ${dur(now - new Date(o.since))})` : ''));
    }
    pushRow(scanRows, { key: d.key, ip: b ? b.ip : d.ip, mac: d.mac, vendor: d.vendor, name: d.final_name, online: up, rtt: b ? b.rtt : null, fail, since, down });
    pk.push(d.key); pu.push(up); pr.push(b ? b.rtt : null);
  }

  // --- 2) scan mein na wali, par network par maujood devices
  const unkRows = newRows();
  const unkKeys = [];
  const newUnknown = [];
  const scanKeySet = new Set(devices.map((d) => d.key));
  for (const b of beat.devices) {
    if (used.has(b)) continue;
    const key = b.mac ? 'mac:' + b.mac : 'ip:' + b.ip;
    if (scanKeySet.has(key)) continue;
    const o = old.get(key);
    unkKeys.push(key);
    if (!o && !firstBeat && !b.self) newUnknown.push(b);
    pushRow(unkRows, { key, ip: b.ip, mac: b.mac, vendor: b.vendor, name: b.name, online: true, rtt: b.rtt, fail: 0, since: o && o.online ? new Date(o.since) : now, down: false });
  }
  for (const b of newUnknown) {
    const rnd = b.mac && (parseInt(b.mac.slice(0, 2), 16) & 2) ? ' (random MAC: probably a phone)' : '';
    alerts.push(`⚠️ New unknown device on the network: ${b.ip}, ${b.mac || 'no MAC'}, ${b.name || b.vendor || 'no name'}${rnd}`);
  }

  await q('UPDATE office_status SET in_scan = FALSE WHERE site = $1 AND in_scan AND NOT (dev_key = ANY($2::text[]))', [site, [...scanKeySet]]);
  await writeStatus(site, scanRows, true);
  await writeStatus(site, unkRows, false);
  await q('UPDATE office_status SET online = FALSE, since = now() WHERE site = $1 AND NOT in_scan AND online AND NOT (dev_key = ANY($2::text[]))', [site, unkKeys]);
  if (pk.length) {
    await q('INSERT INTO office_pings (site, dev_key, up, rtt_ms) SELECT $1::text, t.k, t.u, t.r FROM unnest($2::text[], $3::boolean[], $4::real[]) AS t(k, u, r)', [site, pk, pu, pr]);
  }

  // --- 3) IP conflict: ek IP par MAC ek ghante mein 2 baar badla
  const ipMap = new Map((await q('SELECT ip, mac, window_start, changes FROM office_ipmap WHERE site = $1', [site])).rows.map((r) => [r.ip, r]));
  const conflictIps = [];
  for (const b of beat.devices) {
    if (!b.mac) continue;
    const o = ipMap.get(b.ip);
    if (!o) {
      await q('INSERT INTO office_ipmap (site, ip, mac) VALUES ($1,$2,$3) ON CONFLICT (site, ip) DO NOTHING', [site, b.ip, b.mac]);
    } else if (o.mac !== b.mac) {
      const fresh = now - new Date(o.window_start) > 3600000;
      const changes = fresh ? 1 : o.changes + 1;
      await q('UPDATE office_ipmap SET mac = $3, since = now(), changes = $4, window_start = $5 WHERE site = $1 AND ip = $2',
        [site, b.ip, b.mac, changes, fresh ? now : o.window_start]);
      if (changes >= 2) {
        conflictIps.push(b.ip);
        const detail = `IP ${b.ip} keeps switching between two devices (${o.mac} and ${b.mac}). Two devices are probably using the same address.`;
        if (await upsertIssue(site, 'ip_conflict', b.ip, detail)) alerts.push('⚠️ IP conflict: ' + detail);
      }
    }
  }
  await q(`UPDATE office_issues SET active = FALSE WHERE site = $1 AND kind = 'ip_conflict' AND active AND last_seen < now() - interval '60 minutes'`, [site]);

  // --- 4) 169.254 (router se IP nahi mila)
  const llKeys = [];
  for (const x of beat.link_local) {
    const key = x.mac || x.ip;
    llKeys.push(key);
    const known = devices.find((d) => d.mac && d.mac === x.mac);
    const detail = `${known ? known.final_name : (x.mac || 'A device')} (${x.ip}) could not get an IP address from the router.`;
    if (await upsertIssue(site, 'link_local', key, detail)) alerts.push('⚠️ ' + detail);
  }
  await resolveIssues(site, 'link_local', llKeys);

  // --- 5) DHCP (jab scanner ne check chalaya ho)
  if (beat.dhcp && beat.dhcp.ran) {
    const s = beat.dhcp.servers;
    const rogue = [];
    const other = [];
    if (s.length > 1) {
      rogue.push('dhcp');
      const detail = `${s.length} DHCP servers answered (${s.join(', ')}). Normally only the router should hand out addresses; an extra router or Wi-Fi extender can cause random "no internet" problems.`;
      if (await upsertIssue(site, 'rogue_dhcp', 'dhcp', detail)) alerts.push('⚠️ ' + detail);
    } else if (s.length === 1 && beat.gateway && s[0] !== beat.gateway) {
      other.push('dhcp');
      await upsertIssue(site, 'dhcp_other', 'dhcp', `The DHCP server (${s[0]}) is not the router (${beat.gateway}). This is fine if you set it up on purpose.`);
    }
    await resolveIssues(site, 'rogue_dhcp', rogue);
    await resolveIssues(site, 'dhcp_other', other);
  }

  await sendAlerts(site, alerts);
  return { devices: devices.length, online: onlineN, offline: devices.length - onlineN, unknown: unkKeys.length, alerts: alerts.length };
}

// ---------------------------------------------------------------- page ke liye data
async function healthData(site) {
  const q = (t, p) => pool.query(t, p);
  const mon = (await q('SELECT * FROM office_monitor WHERE site = $1', [site])).rows[0] || null;
  if (mon) mon.silent = Date.now() - new Date(mon.last_beat).getTime() > mon.interval_s * 2500;
  const rows = (await q('SELECT * FROM office_status WHERE site = $1', [site])).rows;
  const status = new Map(rows.map((r) => [r.dev_key, r]));
  const unknown = rows
    .filter((r) => !r.in_scan && !r.marked_known && r.online && r.last_seen && Date.now() - new Date(r.last_seen) < 86400000)
    .sort((a, b) => {
      const x = String(a.ip).split('.').map(Number), y = String(b.ip).split('.').map(Number);
      for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i];
      return 0;
    });
  const st = (await q(
    `WITH p AS (
       SELECT dev_key, up, rtt_ms, LAG(up) OVER (PARTITION BY dev_key ORDER BY at) AS prev
       FROM office_pings WHERE site = $1 AND at > now() - interval '24 hours')
     SELECT dev_key, count(*)::int AS n, count(*) FILTER (WHERE up)::int AS ups,
            count(*) FILTER (WHERE prev AND NOT up)::int AS drops,
            round(avg(rtt_ms) FILTER (WHERE up))::int AS avg_rtt
     FROM p GROUP BY dev_key`, [site])).rows;
  const stats = new Map(st.map((r) => [r.dev_key, {
    drops: r.drops, avg_rtt: r.avg_rtt, n: r.n,
    uptime: r.n >= 3 ? Math.round((1000 * r.ups) / r.n) / 10 : null,
  }]));
  const issues = (await q(
    `SELECT * FROM office_issues WHERE site = $1 AND (active OR last_seen > now() - interval '2 days') ORDER BY active DESC, last_seen DESC LIMIT 20`, [site])).rows;
  return { monitor: mon, status, unknown, stats, issues };
}

// Ek device ka rang: hara (online), peela (slow), laal (offline). Phone ka jana normal hai, isliye gray.
function healthOf(d, st, mon) {
  if (!mon) return { cls: 'secondary', label: '-' };
  if (mon.silent) return { cls: 'secondary', label: 'No data' };
  if (!st) return { cls: 'secondary', label: 'Not checked' };
  if (st.online) {
    return st.rtt_ms != null && st.rtt_ms >= SLOW_MS ? { cls: 'warning', label: 'Slow ' + Math.round(st.rtt_ms) + ' ms' } : { cls: 'success', label: 'Online' };
  }
  const for_ = ' · ' + dur(Date.now() - new Date(st.since).getTime());
  return d.final_type === 'phone' ? { cls: 'secondary', label: 'Away' + for_ } : { cls: 'danger', label: 'Offline' + for_ };
}

// ---------------------------------------------------------------- khule ports ki warning (sirf andaza; password check nahi hota)
function risksFor(d) {
  const ports = new Set(d.ports || []);
  const t = d.final_type;
  const web = `${d.web_title || ''} ${d.server || ''}`;
  const out = [];
  const add = (sev, text, fix) => out.push({ sev, text, fix });
  if (ports.has(23)) add('high', 'Telnet (port 23) is open. It sends passwords without any protection.', 'Turn Telnet off in the device settings and use SSH or the web page instead.');
  if (ports.has(21)) add('medium', 'FTP (port 21) is open. It sends passwords without any protection.', 'Turn FTP off if you do not use it, or switch to SFTP.');
  if (ports.has(5900)) add('medium', 'VNC remote screen (port 5900) is open.', 'Turn it off if not needed; if needed, use a long password and reach it only through a VPN.');
  if (ports.has(3389)) add('medium', 'Remote Desktop (port 3389) is open.', 'Allow it only if needed, use a strong password, and never forward this port on the router to the internet.');
  if (t === 'camera') {
    if (ports.has(37777) || ports.has(34567)) add('medium', 'The camera service port for its recorder/cloud app (' + (ports.has(37777) ? '37777' : '34567') + ') is open. Cameras of this kind are often attacked because of default passwords.', 'Change the camera/NVR password from the default, update its firmware and never forward these ports on the router.');
    if (ports.has(554) || ports.has(8554)) add('info', 'The live video stream (RTSP) can be opened by anyone on the office network.', 'Use a strong camera password and, if possible, keep cameras on a separate network (VLAN) with the recorder.');
  }
  if (t === 'server' && (ports.has(5000) || ports.has(80)) && !ports.has(443)) add('info', 'The NAS / server admin page runs on plain HTTP, so its password travels unprotected inside the network.', 'Turn on HTTPS in its settings. Also make sure its admin password is not the default.');
  else if (['camera', 'network', 'printer'].includes(t) && ports.has(80) && !ports.has(443) && !d.is_self) add('info', 'The admin page is plain HTTP (no HTTPS).', 'Change the default admin password. Use HTTPS if the device offers it.');
  if (['camera', 'printer', 'phone', 'media'].includes(t) && ports.has(445)) add('info', 'File sharing (SMB, port 445) is open on a device that normally does not need it.', 'Turn off file sharing on this device if you do not use it.');
  if (/default|setup wizard|initial setup|first.?time|activate/i.test(web)) add('medium', 'The front page looks like a first-time setup / default page.', 'Open it, finish the setup and set your own admin password.');
  return out;
}

// ---------------------------------------------------------------- server ke andar chowkidaar: monitor chup ho jaye to batao
let ticks = 0;
async function watchTick() {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM office_monitor WHERE NOT silent_alerted AND last_beat < now() - make_interval(secs => (interval_s * 2.5)::float8)');
    for (const m of rows) {
      await pool.query('UPDATE office_monitor SET silent_alerted = TRUE WHERE site = $1', [m.site]);
      await sendAlert(`🟠 ${m.site}: the office monitor has gone silent (last report ${dur(Date.now() - new Date(m.last_beat))} ago). `
        + 'Statuses on the page may be old. Check that the monitor computer is on and connected to the internet.');
    }
    if (ticks++ % 12 === 0) {
      await pool.query(`DELETE FROM office_pings WHERE at < now() - interval '3 days'`);
      await pool.query(`DELETE FROM office_issues WHERE NOT active AND last_seen < now() - interval '30 days'`);
    }
  } catch (err) {
    if (err.code !== '42P01') console.error('[officemon] watch:', err.message); // 42P01: migration_v59 abhi nahi chali
  }
}

function startWatch() {
  const t = setInterval(watchTick, 5 * 60 * 1000);
  if (t.unref) t.unref();
}

module.exports = { cleanBeat, processBeat, healthData, healthOf, risksFor, alertsOn, sendAlert, startWatch, watchTick };
